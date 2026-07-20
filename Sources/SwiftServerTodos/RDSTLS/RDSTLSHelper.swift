import Foundation
import Logging
import NIOSSL


// Root certificates for different AWS regions. Download the bundle for a
// region from https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html
// and add another `<region>.swift` file next to this one.
let rootRDSCertificates = [
    "us-east-1": us_east_1_bundle_pem,
    "eu-west-2": eu_west_2_bundle_pem,
]


func pgAmazonRDSTLSConfiguration(logger: Logger? = nil) throws -> NIOSSLContext {
    let region = ProcessInfo.processInfo.environment["AWS_REGION"] ?? "us-east-1"
    guard let pem = rootRDSCertificates[region] else {
        logger?.error(
            "No root certificate found for the specified AWS region.",
            metadata: ["region": .string(region)]
        )
        throw RDSError.missingRootCertificateForRegion(region)
    }


    let certificatePEM = Array(pem.utf8)
    let rootCert = try NIOSSLCertificate.fromPEMBytes(certificatePEM)


    var tlsConfig = TLSConfiguration.makeClientConfiguration()
    tlsConfig.trustRoots = .certificates(rootCert)
    tlsConfig.certificateVerification = .fullVerification


    return try NIOSSLContext(configuration: tlsConfig)
}


public enum RDSError: Error {
    case missingRootCertificateForRegion(String)
}