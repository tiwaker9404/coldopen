# Observability

coldopen reports three ways: logs (pino JSON), metrics (Prometheus, at `/metrics`) and traces
(OpenTelemetry). Each log line written inside a trace carries `trace_id` and `span_id`, and
every API response carries `x-trace-id`, so a slow request or a failed film leads straight to
its trace.

## Traces

One trace follows a film from the request that made it to the finished video, across
processes: the API stores the trace context (W3C `traceparent`) on the run, and the worker that
picks it up continues the same trace.

```
POST /v1/films                              server span
└─ run film                                 consumer span, on the worker
   ├─ step job                              the job post, read once
   ├─ step research                         the company's site and brand
   ├─ step script
   │  └─ llm …                              each model call the writer makes
   │     └─ chat gpt-oss-120b               model, provider host, input and output tokens
   ├─ step compose
   ├─ step render:0 … render:n              one per scene, the long part
   ├─ step encode
   └─ event: step replayed                  served from the journal after a crash, not re-run
```

| Span                              | Attributes                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /v1/jobs/suggested` (server) | `http.request.method`, `http.route`, `http.response.status_code`                                    |
| `run film` (consumer)             | `coldopen.run.id`, `.agent`, `.attempt`, `.outcome`, `coldopen.worker.id`                           |
| `step`, `llm`, `tool <key>`       | `coldopen.step.key`, `.kind`, `.seq`; errors recorded                                               |
| `chat <model>` (client)           | `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `server.address` |
| `board <ats>` (client)            | `coldopen.board.name`, `coldopen.board.jobs`                                                        |

LLM spans follow OpenTelemetry's GenAI semantic conventions, so backends that understand them
(Grafana, Honeycomb, Langfuse) show token use per call without setup.

## Turning it on

Off unless an exporter is configured; with it off, every helper is a no-op.

| Variable                      |                                                             |
| ----------------------------- | ----------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | any OTLP/HTTP backend, e.g. `http://localhost:4318`         |
| `OTEL_EXPORTER_OTLP_HEADERS`  | its API key, e.g. `authorization=Basic …` for Grafana Cloud |
| `OTEL_SERVICE_NAME`           | defaults to `coldopen-api`, `coldopen-worker`               |
| `OTEL_TRACES_CONSOLE=1`       | print spans to stdout instead                               |

Locally: `docker compose --profile tracing up`, then open Jaeger at http://localhost:16686.

Grafana Cloud's free tier takes OTLP directly: set the endpoint to its OTLP gateway
(`https://otlp-gateway-<region>.grafana.net/otlp`) and the headers to its token.

Code: [src/tracing.ts](../src/tracing.ts). Tests: [test/unit/tracing.test.ts](../test/unit/tracing.test.ts).

## The event loop and shutdown

The hosted app runs on 0.1 CPU, and Render restarts it when `/healthz` takes over 5 seconds, so
anything that holds the event loop shows up here first.

| Signal                                                  | What it says                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coldopen_event_loop_delay_p99_ms` (gauge, `/metrics`)  | How late the event loop ran, 99th percentile over the last 10 seconds, in milliseconds. A few ms is healthy; hundreds mean something is holding it                                                                                    |
| `event loop was blocked` (warn log)                     | A timer due every 250 ms ran more than 1 second late. `delayMs` is how late; `routes` lists the requests in flight then (for example `GET /v1/targets`), and the one that held the loop is usually among them. `/healthz` is left out |
| `shutdown hung on "<step>"; exiting anyway` (error log) | Shutdown passed its deadline: 10 s for `api`, 75 s for `worker`, `all` and `drain`. `hung` names the step that never settled (`http server`, `worker`, `browser`, `tracing` or `database`), and the process exits with code 1         |
| `shutdown step failed` (error log)                      | One step threw; `step` names it, and shutdown goes on to the next                                                                                                                                                                     |

On the hosted app `/metrics` needs an API key (`Authorization: Bearer <key>` from `API_KEYS`).
`/healthz` is the first route and answers from memory, never waiting on the database
(`/readyz` checks the database).

Code: [src/metrics.ts](../src/metrics.ts), [src/shutdown.ts](../src/shutdown.ts).
