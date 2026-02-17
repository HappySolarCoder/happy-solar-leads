# Admin User Management Features

This document describes the admin user management and lead assignment features.

## Features

### 1. **Disposition History Tracking** ✨ NEW

Every disposition change is now automatically tracked in a dedicated `disposition_history` collection for analytics and auditing.

**What's tracked:**
- Lead ID and address
- Previous and new disposition
- User who made the change (ID, name, role)
- GPS data (for knock verification)
- Objection data (if applicable)
- Timestamp
- Source (manual, auto-assignment, claim, admin-action)

**Usage in code:**
```typescript
import { recordDispositionChange } from '@/app/utils/dispositionHistory';

// Record a disposition change
await recordDispositionChange(
  leadId,
  leadAddress,
  previousDisposition,
  newDisposition,
  userId,
  userName,
  userRole,
  {
    knockGpsLat: lat,
    knockGpsLng: lng,
    objectionType: 'too-expensive',
    objectionNotes: 'Budget concerns',
    notes: 'Optional context',
    source: 'manual'
  }
);
```

**Helper functions:**
```typescript
import { 
  updateLeadDisposition,
  claimLead,
  unclaimLead 
} from '@/app/utils/leadHelpers';

// Use these instead of direct updateDoc - they auto-track history
await updateLeadDisposition(leadId, address, oldStatus, newStatus, userId, userName, userRole);
await claimLead(leadId, address, userId, userName, userRole);
await unclaimLead(leadId, address, prevStatus, userId, userName, userRole, 'reason');
```

---

### 2. **Unassign Leads from User** 🔧 NEW

Admin API to remove lead assignments from specific users.

**Endpoint:** `POST /api/admin/unassign-leads`

**Request body:**
```json
{
  "userId": "user-firebase-id",
  "leadIds": ["lead1", "lead2"]  // Optional: specific leads, or all if omitted
}
```

**Response:**
```json
{
  "success": true,
  "unassignedCount": 42,
  "message": "Successfully unassigned 42 lead(s) from John Doe"
}
```

**What it does:**
- Removes `claimedBy`, `assignedTo`, `claimedAt`, `assignedAt`
- Sets `lastAssignedTo` to track previous owner
- Changes status to `unclaimed` (makes lead available again)
- Records disposition history entry preserving who previously owned the lead
- Tracks `unassignedAt` and `unassignedBy` (admin who did it)

**Use cases:**
- Reassign territory when setter leaves
- Reclaim stale leads from inactive users
- Bulk redistribution of leads

---

### 3. **Enhanced User Deletion** 🗑️ UPDATED

Admin API now supports both **soft delete** (reversible) and **hard delete** (permanent).

**Endpoint:** `POST /api/admin/delete-user`

**Request body:**
```json
{
  "userId": "user-firebase-id",
  "deleteType": "soft"  // or "hard"
}
```

#### Soft Delete
**What it does:**
- Marks user as `deleted: true`
- Sets `deletedAt`, `deletedBy`
- Sets `isActive: false` (stops auto-assignment)
- Disables Firebase Auth account (can't log in)
- **Preserves all data** (user doc, lead assignments, history)

**Use cases:**
- Temporary suspension
- Compliance hold
- Reversible deactivation

**Response:**
```json
{
  "success": true,
  "deleteType": "soft",
  "message": "User \"John Doe\" soft deleted (marked inactive, can be restored)"
}
```

#### Hard Delete
**What it does:**
- Unclaims ALL leads assigned to user (makes them available)
- Sets `lastAssignedTo` on each lead (tracks previous owner)
- **Preserves disposition history** (audit trail intact)
- Records admin action in disposition history
- Deletes Firebase Auth account
- Deletes user document from Firestore

**Use cases:**
- GDPR/right-to-be-forgotten requests
- Permanent account removal
- Complete cleanup after investigation

**Response:**
```json
{
  "success": true,
  "deleteType": "hard",
  "unclaimedLeadsCount": 156,
  "message": "User \"John Doe\" permanently deleted",
  "note": "Disposition history preserved for auditing"
}
```

**Important:** Disposition history is ALWAYS preserved, even on hard delete. This ensures:
- Audit trail for compliance
- Metrics remain accurate (door knocks, conversions, etc.)
- You can see who originally worked each lead

---

## Firestore Collections

### `disposition_history`
New collection that tracks all disposition changes.

**Document structure:**
```typescript
{
  id: string;
  leadId: string;
  leadAddress: string;
  previousDisposition?: string;
  newDisposition: string;
  userId: string;
  userName: string;
  userRole: string;
  knockGpsLat?: number;
  knockGpsLng?: number;
  knockGpsAccuracy?: number;
  knockDistanceFromAddress?: number;
  objectionType?: string;
  objectionNotes?: string;
  createdAt: Date;
  notes?: string;
  source?: 'manual' | 'auto-assignment' | 'claim' | 'admin-action';
}
```

### New Lead Fields
```typescript
{
  lastAssignedTo?: string;      // Previous owner (for reassignment tracking)
  unassignedAt?: Date;           // When lead was unassigned
  unassignedBy?: string;         // Admin who unassigned it
  unclaimReason?: string;        // Why it was unclaimed
}
```

### New User Fields (soft delete)
```typescript
{
  deleted?: boolean;             // Soft delete flag
  deletedAt?: Date;              // When deleted
  deletedBy?: string;            // Admin who deleted
}
```

---

## Firestore Indexes

The following indexes are required (already configured in `firestore.indexes.json`):

```json
{
  "collectionGroup": "disposition_history",
  "fields": [
    { "fieldPath": "leadId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "disposition_history",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "disposition_history",
  "fields": [
    { "fieldPath": "newDisposition", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

Deploy indexes with:
```bash
firebase deploy --only firestore:indexes
```

---

## Frontend Integration

**To add unassign functionality to Admin Panel:**

```tsx
// In user management UI
async function handleUnassignLeads(userId: string) {
  const token = await user.getIdToken();
  
  const response = await fetch('/api/admin/unassign-leads', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });
  
  const result = await response.json();
  
  if (result.success) {
    alert(`Unassigned ${result.unassignedCount} leads from user`);
  }
}
```

**To add soft/hard delete options:**

```tsx
async function handleDeleteUser(userId: string, deleteType: 'soft' | 'hard') {
  const confirmed = confirm(
    deleteType === 'hard'
      ? 'PERMANENT DELETE: This will remove the user completely and unclaim their leads. Continue?'
      : 'Soft delete: User will be disabled but data preserved. Continue?'
  );
  
  if (!confirmed) return;
  
  const token = await user.getIdToken();
  
  const response = await fetch('/api/admin/delete-user', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, deleteType }),
  });
  
  const result = await response.json();
  
  if (result.success) {
    alert(result.message);
    if (result.unclaimedLeadsCount) {
      console.log(`Unclaimed ${result.unclaimedLeadsCount} leads`);
    }
  }
}
```

---

## Security

- All APIs require Firebase Auth token
- All APIs verify admin role before proceeding
- Cannot delete your own account
- All admin actions are logged in disposition history
- Disposition history is immutable (append-only)

---

## Testing

**Test disposition history:**
```bash
# Check if history is being recorded
firebase firestore:get disposition_history --limit 10
```

**Test unassign:**
```bash
curl -X POST https://your-app.vercel.app/api/admin/unassign-leads \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user-id"}'
```

**Test soft delete:**
```bash
curl -X POST https://your-app.vercel.app/api/admin/delete-user \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user-id", "deleteType": "soft"}'
```

---

## Analytics Queries

**Get user performance history:**
```typescript
import { getUserDispositionHistory } from '@/app/utils/dispositionHistory';

const history = await getUserDispositionHistory(userId, 100);
// Returns all disposition changes by this user
```

**Get lead history:**
```typescript
import { getLeadDispositionHistory } from '@/app/utils/dispositionHistory';

const history = await getLeadDispositionHistory(leadId, 50);
// Returns full disposition timeline for a lead
```

**Advanced queries:**
```typescript
import { getDispositionHistory } from '@/app/utils/dispositionHistory';

// Get all sales this week
const sales = await getDispositionHistory({
  disposition: 'sale',
  startDate: new Date('2026-02-16'),
  endDate: new Date('2026-02-23'),
  limit: 1000,
});

// Get specific user's history in date range
const userHistory = await getDispositionHistory({
  userId: 'user-id',
  startDate: new Date('2026-02-01'),
  endDate: new Date('2026-02-28'),
});
```

---

## Migration Notes

**For existing apps:**

1. Deploy Firestore indexes first:
   ```bash
   firebase deploy --only firestore:indexes
   ```

2. Update any code that directly updates lead disposition to use helper functions:
   ```typescript
   // OLD
   await updateDoc(leadRef, { status: 'interested' });
   
   // NEW
   await updateLeadDisposition(
     leadId, address, oldStatus, 'interested', 
     userId, userName, userRole
   );
   ```

3. The `disposition_history` collection will start populating automatically with new changes. Historical data won't be backfilled unless you run a migration script.

---

## Future Enhancements

- Admin UI for viewing disposition history
- Analytics dashboard for team performance
- Bulk lead reassignment tool
- Automatic stale lead detection and reassignment
- User restoration from soft delete

---

**Questions?** Check the code comments in:
- `app/types/dispositionHistory.ts`
- `app/utils/dispositionHistory.ts`
- `app/utils/leadHelpers.ts`
- `app/api/admin/unassign-leads/route.ts`
- `app/api/admin/delete-user/route.ts`
