import Configuration
import Fluent
import FluentPostgresDriver
import Foundation
import Vapor

func configureDatabase(app: Application, config: ConfigReader) async throws {
    let env = ProcessInfo.processInfo.environment
    let host = env["DB_HOST"] ?? "localhost"

    let tls: PostgresConnection.Configuration.TLS
    switch host {
    case "localhost", "postgres":
        tls = .disable
    default:
        tls = try .require(pgAmazonRDSTLSConfiguration(logger: app.logger))
    }

    let sqlConfig = SQLPostgresConfiguration(
        hostname: host,
        port: SQLPostgresConfiguration.ianaPortNumber,
        username: env["DB_USER"] ?? "postgres",
        password: env["DB_PASS"],
        database: env["DB_NAME"] ?? "postgres",
        tls: tls
    )
    app.databases.use(.postgres(configuration: sqlConfig), as: .psql)

    app.migrations.add([
        Migrations.CreateTODOs()
    ])
    try await app.autoMigrate()
}

enum DB {
    final class TODO: Model, @unchecked Sendable {
        static let schema = "todos"

        @ID(custom: "id", generatedBy: .user)
        var id: String?

        @Field(key: "contents")
        var contents: String
    }
}

enum Migrations {
    struct CreateTODOs: AsyncMigration {
        func prepare(on database: Database) async throws {
            try await database.schema(DB.TODO.schema)
                .field("id", .string, .identifier(auto: false))
                .field("contents", .string, .required)
                .create()
        }

        func revert(on database: Database) async throws {
            try await database
                .schema(DB.TODO.schema)
                .delete()
        }
    }
}
