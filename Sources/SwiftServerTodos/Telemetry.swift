import Configuration
import Foundation
import Logging
import Metrics
import OTel
import ServiceLifecycle
import SystemMetrics
import Tracing
import Vapor


/// Stands in for the telemetry services when export is switched off.
///
/// `Entrypoint` puts this into a `ServiceGroup` whose default
/// `successTerminationBehavior` is `.cancelGroup`, so a service that returns
/// early takes the HTTP server down with it. Idling until shutdown avoids that.
struct NoTelemetryService: Service {
    func run() async throws { try await gracefulShutdown() }
}

func configureTelemetry(_ config: ConfigReader) async throws -> (Logger, some Service) {
    let level = config.scoped(to: "log")
        .string(forKey: "level")
        .flatMap { Logger.Level.init(rawValue: $0) } ?? .info


    // Telemetry export is on by default, because `docker-compose.yaml` runs a
    // `grafana/otel-lgtm` container and points the app at it with
    // OTEL_EXPORTER_OTLP_ENDPOINT. That is what the telemetry chapter builds on.
    //
    // Set OTEL_ENABLED=false wherever no collector is reachable. The Fargate
    // task in `aws-infra/lib/service-stack.ts` does exactly that: nothing
    // listens on localhost:4318 there, so each exporter retries on a timer and
    // buries the application's own logs in connection-refused warnings.
    //
    // Do not use the OTel spec's OTEL_SDK_DISABLED or OTEL_LOGS_EXPORTER for
    // this. Swift OTel *throws* from the backend factories when the matching
    // signal is disabled -- invalidConfiguration("makeLoggingBackend called but
    // config has logs disabled") -- which crashes the process at startup. The
    // factory calls themselves have to be skipped, and no variable read inside
    // the SDK can do that.
    //
    // To re-enable telemetry on AWS: drop OTEL_ENABLED from the container
    // environment in service-stack.ts, add an ADOT collector sidecar listening
    // on 4318, then `cdk deploy ServiceStack`.
    guard config.scoped(to: "otel").bool(forKey: "enabled", default: true) else {
        LoggingSystem.bootstrap { label in
            ConsoleLogger(label: label, console: Terminal(), level: level)
        }
        let logger = Logger(label: "SwiftServerTodos")
        logger.info("OTEL_ENABLED=false, exporting no telemetry; logs go to the console only")
        return (logger, ServiceGroup(services: [NoTelemetryService()], logger: logger))
    }


    // Logs, metrics, and traces are exported via OpenTelemetry (OTLP).
    // The OTel diagnostic logger is left as default (stderr) so OTel's own
    // internal logs don't recurse back through the multiplexed handler below.
    var otelConfig = OTel.Configuration.default
    otelConfig.serviceName = "SwiftServerTodos"


    // Create the OTel backends.
    let otelLoggingBackend = try OTel.makeLoggingBackend(configuration: otelConfig)
    let otelMetricsBackend = try OTel.makeMetricsBackend(configuration: otelConfig)
    let otelTracingBackend = try OTel.makeTracingBackend(configuration: otelConfig)


    // Fan logs out to both the Vapor console logger and the OTel exporter.
    // The OTel metadata provider attaches `trace_id` and `span_id` from the
    // active span, so logs emitted during a traced request can be correlated
    // with their trace in Grafana.
    LoggingSystem.bootstrap(
        { label, metadataProvider in
            MultiplexLogHandler(
                [
                    ConsoleLogger(label: label, console: Terminal(), level: level),
                    otelLoggingBackend.factory(label),
                ],
                metadataProvider: metadataProvider
            )
        },
        metadataProvider: OTel.makeLoggingMetadataProvider()
    )
    MetricsSystem.bootstrap(otelMetricsBackend.factory)
    InstrumentationSystem.bootstrap(otelTracingBackend.factory)


    let logger = Logger(label: "SwiftServerTodos")


    // Collect system-level metrics (CPU, memory, file descriptors, etc.).
    let systemMetricsMonitor = SystemMetricsMonitor(
        metricsFactory: otelMetricsBackend.factory,
        logger: logger
    )


    // Combine all OTel services so they start and stop together.
    let telemetryService = ServiceGroup(
        services: [
            otelLoggingBackend.service,
            otelMetricsBackend.service,
            otelTracingBackend.service,
            systemMetricsMonitor,
        ], logger: logger)


    return (logger, telemetryService)
}

struct RequestLoggerInjectionMiddleware: Vapor.AsyncMiddleware {
    func respond(to request: Request, chainingTo next: any AsyncResponder) async throws -> Response {
        try await withLogger(request.logger) { logger in
            try await next.respond(to: request)
        }
    }
}
