import { trace } from '@opentelemetry/api'
import pino from 'pino'

export function createLogger(level: string, name: string) {
  return pino({
    level,
    name,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ['secret', '*.secret', 'secrets', '*.secrets', 'req.headers.authorization'],
    // every line logged inside a trace carries its id, so a log line leads to its trace
    mixin: () => {
      const c = trace.getActiveSpan()?.spanContext()
      return c && trace.isSpanContextValid(c) ? { trace_id: c.traceId, span_id: c.spanId } : {}
    },
  })
}

export type Logger = ReturnType<typeof createLogger>
