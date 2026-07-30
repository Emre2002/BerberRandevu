# Booking Flow

Public: availability API → create API → Admin SDK transaction → slot lock → idempotency.

Owner manual: authenticated `POST /api/owner/create-appointment` — businessId from membership.

Notifications are best-effort after successful write.

Emulator rollback: `?forceClientBooking=1` on localhost only.
