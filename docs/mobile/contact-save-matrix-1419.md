# Contact save matrix, 14.19

Contact and photo edits are direct Firestore writes. `/api/field/dispo` is never called with contact keys. Notes are a separate draft, and only when the text changed. A permission-denied contact write parks as `contact_denied` and reopens once per app start.

| case | mode | path | 14.17 result | 14.19 result |
| --- | --- | --- | --- | --- |
| phone only | online | direct | pass | pass |
| phone only | online | route | baseline: blocked draft, no write | pass |
| phone only | online | manager | baseline: blocked draft, no write | pass |
| phone only | offline | direct | pass | pass |
| phone only | offline | route | baseline: blocked draft, no write | pass |
| phone only | offline | manager | baseline: blocked draft, no write | pass |
| email only | online | direct | pass | pass |
| email only | online | route | baseline: blocked draft, no write | pass |
| email only | online | manager | baseline: blocked draft, no write | pass |
| email only | offline | direct | pass | pass |
| email only | offline | route | baseline: blocked draft, no write | pass |
| email only | offline | manager | baseline: blocked draft, no write | pass |
| name only | online | direct | pass | pass |
| name only | online | route | baseline: blocked draft, no write | pass |
| name only | online | manager | baseline: blocked draft, no write | pass |
| name only | offline | direct | pass | pass |
| name only | offline | route | baseline: blocked draft, no write | pass |
| name only | offline | manager | baseline: blocked draft, no write | pass |
| address only | online | direct | pass | pass |
| address only | online | route | baseline: blocked draft, no write | pass |
| address only | online | manager | baseline: blocked draft, no write | pass |
| address only | offline | direct | pass | pass |
| address only | offline | route | baseline: blocked draft, no write | pass |
| address only | offline | manager | baseline: blocked draft, no write | pass |
| photo only | online | direct | pass | pass |
| photo only | online | route | baseline: blocked draft, no write | pass |
| photo only | online | manager | baseline: blocked draft, no write | pass |
| photo only | offline | direct | pass | pass |
| photo only | offline | route | baseline: blocked draft, no write | pass |
| photo only | offline | manager | baseline: blocked draft, no write | pass |
| notes only | online | direct | pass | pass |
| notes only | online | route | pass | pass |
| notes only | online | manager | pass | pass |
| notes only | offline | direct | pass | pass |
| notes only | offline | route | pass | pass |
| notes only | offline | manager | pass | pass |
| notes + phone | online | direct | pass | pass |
| notes + phone | online | route | baseline: blocked draft, no write | pass |
| notes + phone | online | manager | baseline: blocked draft, no write | pass |
| notes + phone | offline | direct | pass | pass |
| notes + phone | offline | route | baseline: blocked draft, no write | pass |
| notes + phone | offline | manager | baseline: blocked draft, no write | pass |
| Send Info | online | direct | pass | pass |
| Send Info | online | route | baseline: blocked draft, no write | pass |
| Send Info | online | manager | baseline: blocked draft, no write | pass |
| Send Info | offline | direct | pass | pass |
| Send Info | offline | route | baseline: blocked draft, no write | pass |
| Send Info | offline | manager | baseline: blocked draft, no write | pass |
| parked note + phone | online | direct | pass | pass |
| parked note + phone | online | route | baseline: blocked draft, no write | pass |
| parked note + phone | online | manager | baseline: blocked draft, no write | pass |
| parked note + phone | offline | direct | pass | pass |
| parked note + phone | offline | route | baseline: blocked draft, no write | pass |
| parked note + phone | offline | manager | baseline: blocked draft, no write | pass |
| bill only | online | direct | pass | pass |
| bill only | online | route | baseline: blocked draft, no write | pass |
| bill only | online | manager | baseline: blocked draft, no write | pass |
| bill only | offline | direct | pass | pass |
| bill only | offline | route | baseline: blocked draft, no write | pass |
| bill only | offline | manager | baseline: blocked draft, no write | pass |
| phone clear allowed | online | direct | pass | pass |
| phone clear allowed | offline | direct | pass | pass |
| phone clear denied | online | route | baseline: blocked draft, no write | pass |
| phone clear denied | online | manager | baseline: blocked draft, no write | pass |
| phone clear denied | offline | route | baseline: blocked draft, no write | pass |
| phone clear denied | offline | manager | baseline: blocked draft, no write | pass |
| legacy empty notes | online | direct | pass | pass |
| legacy empty notes | online | route | baseline: blocked draft, no write | pass |
| legacy empty notes | online | manager | baseline: blocked draft, no write | pass |
| legacy empty notes | offline | direct | pass | pass |
| legacy empty notes | offline | route | baseline: blocked draft, no write | pass |
| legacy empty notes | offline | manager | baseline: blocked draft, no write | pass |
| Send Info notes too long | online | direct | pass | pass |
| Send Info notes too long | online | route | baseline: blocked draft, no write | pass |
| Send Info notes too long | online | manager | baseline: blocked draft, no write | pass |
| Send Info notes too long | offline | direct | pass | pass |
| Send Info notes too long | offline | route | baseline: blocked draft, no write | pass |
| Send Info notes too long | offline | manager | baseline: blocked draft, no write | pass |
| parked + empty edit | online | direct | pass | pass |
| parked + empty edit | online | route | pass | pass |
| parked + empty edit | online | manager | pass | pass |
| parked + empty edit | offline | direct | pass | pass |
| parked + empty edit | offline | route | pass | pass |
| parked + empty edit | offline | manager | pass | pass |
| parked + deliberate clear | online | direct | pass | pass |
| parked + deliberate clear | online | route | pass | pass |
| parked + deliberate clear | online | manager | pass | pass |
| parked + deliberate clear | offline | direct | pass | pass |
| parked + deliberate clear | offline | route | pass | pass |
| parked + deliberate clear | offline | manager | pass | pass |
| parked + substring note | online | direct | pass | pass |
| parked + substring note | online | route | pass | pass |
| parked + substring note | online | manager | pass | pass |
| parked + substring note | offline | direct | pass | pass |
| parked + substring note | offline | route | pass | pass |
| parked + substring note | offline | manager | pass | pass |
