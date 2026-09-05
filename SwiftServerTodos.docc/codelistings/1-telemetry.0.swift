import Configuration
import Foundation
import Logging
import Vapor

func configureTelemetry(_ config: ConfigReader) async throws {
    let level = config.scoped(to: "log")
        .string(forKey: "level")
        .flatMap { Logger.Level.init(rawValue: $0) } ?? .info
    LoggingSystem.bootstrap { label in
        ConsoleLogger(label: label, console: Terminal(), level: level)
    }
}

struct RequestLoggerInjectionMiddleware: Vapor.AsyncMiddleware {
    func respond(to request: Request, chainingTo next: any AsyncResponder) async throws -> Response {
        try await withLogger(request.logger) { _ in
            try await next.respond(to: request)
        }
    }
}
