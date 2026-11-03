import {
  type Attributes,
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { LlmProvider } from './llm/types.ts'

/**
 * OpenTelemetry tracing: one trace per API request and per film run, with a span for each
 * durable step, LLM call and job board read. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (any
 * OTLP/HTTP backend: Jaeger, Grafana Tempo, Honeycomb), or OTEL_TRACES_CONSOLE=1 to print spans.
 * When it's off every helper here is a no-op, so the code paths are the same either way.
 */

export const tracer = trace.getTracer('coldopen')

export interface Tracing {
  shutdown(): Promise<void>
}

/** Turns tracing on for this process. `exporter` is for tests (an in-memory one). */
export function startTracing(
  service: string,
  opts: { exporter?: SpanExporter; env?: NodeJS.ProcessEnv } = {},
): Tracing | null {
  const env = opts.env ?? process.env
  const processors: SpanProcessor[] = []
  if (opts.exporter) processors.push(new SimpleSpanProcessor({ exporter: opts.exporter }))
  else if (env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
    // reads the endpoint and headers (OTEL_EXPORTER_OTLP_HEADERS, for an API key) from env
    processors.push(new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }))
  if (env.OTEL_TRACES_CONSOLE === '1')
    processors.push(new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }))
  if (!processors.length) return null

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME ?? service,
      'service.version': env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
      'deployment.environment.name': env.HOSTED === 'true' ? 'hosted' : 'local',
    }),
    spanProcessors: processors,
  })
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  trace.setGlobalTracerProvider(provider)
  return {
    async shutdown() {
      await provider.forceFlush().catch(() => {})
      await provider.shutdown().catch(() => {})
      trace.disable()
      context.disable()
      propagation.disable()
    },
  }
}

/** Runs fn inside a new span, ending it (with the error, if fn throws) when fn settles */
export async function inSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return tracer.startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      fail(span, err)
      throw err
    } finally {
      span.end()
    }
  })
}

export function fail(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : new Error(String(err)))
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  })
}

/** The current trace's id, for logs and the x-trace-id header; undefined when not tracing */
export function traceId(): string | undefined {
  const c = trace.getActiveSpan()?.spanContext()
  return c && trace.isSpanContextValid(c) ? c.traceId : undefined
}

/** The current trace context as headers (traceparent), to hand to another process */
export function carrier(): Record<string, string> {
  const out: Record<string, string> = {}
  propagation.inject(context.active(), out)
  return out
}

/** Runs fn as part of the trace a carrier came from (a run started by an API request) */
export function withCarrier<T>(c: Record<string, string> | undefined | null, fn: () => T): T {
  if (!c) return fn()
  return context.with(propagation.extract(context.active(), c), fn)
}

/** Each LLM call as a client span, with the GenAI semantic conventions' attributes */
export function tracedLlm(p: LlmProvider, server: string): LlmProvider {
  const model = p.name.replace(/^openai-compatible:/, '')
  return {
    name: p.name,
    complete: (req) =>
      inSpan(
        `chat ${model}`,
        {
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': model,
          'gen_ai.request.temperature': req.temperature ?? 0,
          'server.address': server,
          'coldopen.llm.structured': Boolean(req.schema),
        },
        async (span) => {
          const out = await p.complete(req)
          span.setAttributes({
            'gen_ai.response.model': out.model,
            'gen_ai.usage.input_tokens': out.inputTokens,
            'gen_ai.usage.output_tokens': out.outputTokens,
          })
          return out
        },
        SpanKind.CLIENT,
      ),
  }
}

const SPAN = Symbol('span')
type Traced = FastifyRequest & { [SPAN]?: Span }

/**
 * A server span for every request, continuing the caller's trace when it sends a traceparent.
 * Register before any route: each handler is wrapped so it runs inside its request's span.
 */
export function registerHttpTracing(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const handler = route.handler
    route.handler = function (this: unknown, req: FastifyRequest, reply: FastifyReply) {
      const span = (req as Traced)[SPAN]
      if (!span) return handler.call(this as never, req, reply)
      return context.with(trace.setSpan(context.active(), span), () =>
        handler.call(this as never, req, reply),
      )
    } as typeof handler
  })
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/healthz') || req.url.startsWith('/metrics')) return
    const parent = propagation.extract(context.active(), req.headers)
    const route = req.routeOptions.url ?? 'unmatched'
    const span = tracer.startSpan(
      `${req.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': req.method,
          'http.route': route,
          'url.path': req.url.split('?')[0]!,
          'user_agent.original': req.headers['user-agent'] ?? '',
        },
      },
      parent,
    )
    ;(req as Traced)[SPAN] = span
    const id = span.spanContext().traceId
    if (trace.isSpanContextValid(span.spanContext())) reply.header('x-trace-id', id)
  })
  app.addHook('onError', async (req, _reply, err) => {
    const span = (req as Traced)[SPAN]
    if (span) fail(span, err)
  })
  app.addHook('onResponse', async (req, reply) => {
    const span = (req as Traced)[SPAN]
    if (!span) return
    span.setAttribute('http.response.status_code', reply.statusCode)
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
    span.end()
  })
}

export { SpanKind }
