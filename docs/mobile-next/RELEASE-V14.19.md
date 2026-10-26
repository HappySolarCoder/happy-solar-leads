# Raydar 14.19 (159)

Requires #175 deployed. The notes route is main `15efe05` (`POST /api/field/dispo`).

- A missing notes key means no notes change.
- A deliberate clear sends `notes: ""`, `baseNotes`, and `clearNotes: true`. The flag is never stripped, and a clear is never resent without it.
- A `notes_empty` or `notes_clear_mismatch` response, or a 400 whose field is `clearNotes`, parks as `notes_rejected`. The note text stays on the draft. There is no retry. It reopens once per app start.
- A whitespace-only edit does not send a notes draft. A blank note is never sent without `clearNotes`.
- Send Info does not post while that lead still has a parked or unsent contact draft. On the web, the native contact-write gate stays off.
