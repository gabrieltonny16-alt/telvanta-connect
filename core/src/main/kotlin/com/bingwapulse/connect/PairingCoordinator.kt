package com.bingwapulse.connect

import java.util.UUID

/**
 * In-memory pairing consent state machine.
 *
 * This deliberately does NOT create a network connection or claim peer authentication.
 * READY_FOR_SECURE_TRANSPORT means only that both device identities have confirmed the
 * same short-lived pairing request. A reviewed cryptographic transport must follow.
 */
enum class PairingStatus { WAITING_FOR_CONFIRMATIONS, READY_FOR_SECURE_TRANSPORT, REJECTED, EXPIRED, REVOKED, DISCONNECTED }

data class PairingRequest(
    val id: String,
    val initiatorDeviceId: String,
    val peerDeviceId: String,
    val scopes: Set<String>,
    val createdAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val initiatorConfirmed: Boolean,
    val peerConfirmed: Boolean,
    val status: PairingStatus
)

class PairingCoordinator(
    private val now: () -> Long = System::currentTimeMillis,
    private val ttlMs: Long = DEFAULT_TTL_MS,
    private val allowedScopes: Set<String> = DEFAULT_SCOPES
) {
    private val requests = linkedMapOf<String, PairingRequest>()

    init { require(ttlMs in 1_000L..MAX_TTL_MS) { "Pairing TTL must be between 1 second and 10 minutes" } }

    @Synchronized
    fun begin(initiatorDeviceId: String, peerDeviceId: String, scopes: Set<String>): PairingRequest {
        require(initiatorDeviceId.isNotBlank() && peerDeviceId.isNotBlank())
        require(initiatorDeviceId != peerDeviceId) { "A device cannot pair with itself" }
        require(scopes.isNotEmpty() && scopes.all { it in allowedScopes }) { "Requested scope is not allowed" }
        val created = now()
        val request = PairingRequest(
            id = UUID.randomUUID().toString(),
            initiatorDeviceId = initiatorDeviceId,
            peerDeviceId = peerDeviceId,
            scopes = scopes.toSet(),
            createdAtEpochMs = created,
            expiresAtEpochMs = created + ttlMs,
            initiatorConfirmed = true,
            peerConfirmed = false,
            status = PairingStatus.WAITING_FOR_CONFIRMATIONS
        )
        requests[request.id] = request
        return request
    }

    @Synchronized
    fun confirm(requestId: String, deviceId: String): PairingRequest {
        val current = active(requestId)
        require(current.status == PairingStatus.WAITING_FOR_CONFIRMATIONS) { "Pairing request is not awaiting consent" }
        val updated = when (deviceId) {
            current.initiatorDeviceId -> current.copy(initiatorConfirmed = true)
            current.peerDeviceId -> current.copy(peerConfirmed = true)
            else -> throw IllegalArgumentException("Device is not part of this pairing request")
        }
        return store(if (updated.initiatorConfirmed && updated.peerConfirmed) updated.copy(status = PairingStatus.READY_FOR_SECURE_TRANSPORT) else updated)
    }

    @Synchronized
    fun reject(requestId: String, deviceId: String): PairingRequest {
        val current = active(requestId)
        require(deviceId == current.initiatorDeviceId || deviceId == current.peerDeviceId) { "Device is not part of this pairing request" }
        require(current.status == PairingStatus.WAITING_FOR_CONFIRMATIONS) { "Pairing request is no longer pending" }
        return store(current.copy(status = PairingStatus.REJECTED))
    }

    @Synchronized
    fun revoke(requestId: String, deviceId: String): PairingRequest {
        val current = get(requestId)
        require(deviceId == current.initiatorDeviceId || deviceId == current.peerDeviceId) { "Device is not part of this pairing request" }
        require(current.status == PairingStatus.READY_FOR_SECURE_TRANSPORT) { "Only mutually approved requests can be revoked" }
        return store(current.copy(status = PairingStatus.REVOKED))
    }

    @Synchronized
    fun disconnect(requestId: String, deviceId: String): PairingRequest {
        val current = get(requestId)
        require(deviceId == current.initiatorDeviceId || deviceId == current.peerDeviceId) { "Device is not part of this pairing request" }
        require(current.status == PairingStatus.READY_FOR_SECURE_TRANSPORT) { "Request is not ready for transport" }
        return store(current.copy(status = PairingStatus.DISCONNECTED))
    }

    @Synchronized
    fun find(requestId: String): PairingRequest = active(requestId)

    private fun active(id: String): PairingRequest {
        val current = get(id)
        if (current.status == PairingStatus.WAITING_FOR_CONFIRMATIONS && now() >= current.expiresAtEpochMs) {
            return store(current.copy(status = PairingStatus.EXPIRED))
        }
        return current
    }

    private fun get(id: String): PairingRequest = requests[id] ?: throw NoSuchElementException("Unknown pairing request")
    private fun store(request: PairingRequest): PairingRequest { requests[request.id] = request; return request }

    companion object {
        const val DEFAULT_TTL_MS = 120_000L
        const val MAX_TTL_MS = 600_000L
        val DEFAULT_SCOPES = setOf("offers:read", "orders:read", "customers:read", "sync:write")
    }
}
