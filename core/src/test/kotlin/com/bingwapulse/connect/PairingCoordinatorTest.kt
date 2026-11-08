package com.bingwapulse.connect

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PairingCoordinatorTest {
    private var clock = 10_000L
    private val coordinator = PairingCoordinator(now = { clock })

    @Test fun requiresBothDevicesToApprove() {
        val request = coordinator.begin("phone-a", "phone-b", setOf("offers:read"))
        assertEquals(PairingStatus.WAITING_FOR_CONFIRMATIONS, request.status)
        val ready = coordinator.confirm(request.id, "phone-b")
        assertEquals(PairingStatus.READY_FOR_SECURE_TRANSPORT, ready.status)
        assertTrue(ready.initiatorConfirmed && ready.peerConfirmed)
    }

    @Test fun expiresPendingRequest() {
        val request = coordinator.begin("phone-a", "phone-b", setOf("orders:read"))
        clock = request.expiresAtEpochMs
        assertEquals(PairingStatus.EXPIRED, coordinator.find(request.id).status)
        assertFailsWith<IllegalArgumentException> { coordinator.confirm(request.id, "phone-b") }
    }

    @Test fun rejectsUnknownDeviceAndUnknownScope() {
        assertFailsWith<IllegalArgumentException> { coordinator.begin("a", "b", setOf("payments:execute")) }
        val request = coordinator.begin("a", "b", setOf("offers:read"))
        assertFailsWith<IllegalArgumentException> { coordinator.confirm(request.id, "intruder") }
    }

    @Test fun rejectionAndRevocationAreTerminal() {
        val rejected = coordinator.begin("a", "b", setOf("offers:read"))
        assertEquals(PairingStatus.REJECTED, coordinator.reject(rejected.id, "b").status)
        val approved = coordinator.begin("a", "b", setOf("offers:read"))
        coordinator.confirm(approved.id, "b")
        assertEquals(PairingStatus.REVOKED, coordinator.revoke(approved.id, "a").status)
        assertFalse(coordinator.find(approved.id).status == PairingStatus.READY_FOR_SECURE_TRANSPORT)
    }

    @Test fun preventsSelfPairingAndEmptyScopes() {
        assertFailsWith<IllegalArgumentException> { coordinator.begin("a", "a", setOf("offers:read")) }
        assertFailsWith<IllegalArgumentException> { coordinator.begin("a", "b", emptySet()) }
    }
}
