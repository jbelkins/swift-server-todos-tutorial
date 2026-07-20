import Configuration
import Fluent
import FluentPostgresDriver
import Foundation
import Vapor

func configureDatabase(app: Application, config: ConfigReader) async throws {
    let postgresConfig = config.scoped(to: "postgres")
    let postgresURL = postgresConfig.string(
        forKey: "url",
        as: URL.self,
        default: URL(string: "postgres://postgres@localhost:5432/postgres?sslmode=disable")!
    )

    // Amazon RDS and Aurora require TLS. Local Postgres in docker-compose
    // does not. Branch on the hostname so the same code path works in both
    // environments.
    let host = postgresURL.host ?? "localhost"
    let tls: PostgresConnection.Configuration.TLS
    switch host {
    case "localhost", "postgres":
        tls = .disable
    default:
        tls = try .require(pgAmazonRDSTLSConfiguration(logger: app.logger))
    }

    let sqlConfig = try SQLPostgresConfiguration(url: postgresURL).applyingTLS(tls)
    app.databases.use(.postgres(configuration: sqlConfig), as: .psql)

    app.migrations.add([
        Migrations.CreateTODOs()
    ])
    try await app.autoMigrate()
}

extension SQLPostgresConfiguration {
    fileprivate func applyingTLS(_ tls: PostgresConnection.Configuration.TLS) -> SQLPostgresConfiguration {
        SQLPostgresConfiguration(
            hostname: self.coreConfiguration.host ?? "localhost",
            port: self.coreConfiguration.port ?? SQLPostgresConfiguration.ianaPortNumber,
            username: self.coreConfiguration.username,
            password: self.coreConfiguration.password,
            database: self.coreConfiguration.database,
            tls: tls
        )
    }
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
