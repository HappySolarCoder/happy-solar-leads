import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadEditorPatch, type LeadEditorForm } from '../app/utils/leadEditorPatch';

const saved = {
  name: 'Homeowner',
  address: '1 Main St',
  city: 'Buffalo',
  state: 'NY',
  zip: '14201',
  phone: '7165550100',
  email: 'home@example.com',
  estimatedBill: 150,
  notes: 'gate code 4',
};

function form(overrides: Partial<LeadEditorForm> = {}): LeadEditorForm {
  return {
    name: saved.name,
    address: saved.address,
    city: saved.city,
    state: saved.state,
    zip: saved.zip,
    phone: saved.phone,
    email: saved.email,
    estimatedBill: String(saved.estimatedBill),
    notes: saved.notes,
    ...overrides,
  };
}

describe('buildLeadEditorPatch', () => {
  it('sends nothing when every contact field is unchanged', () => {
    assert.deepEqual(buildLeadEditorPatch(saved, form()), {});
    assert.deepEqual(buildLeadEditorPatch(saved, form({ estimatedBill: 150 })), {});
  });

  it('sends only the field that changed', () => {
    assert.deepEqual(buildLeadEditorPatch(saved, form({ email: 'new@example.com' })), {
      email: 'new@example.com',
    });
    assert.deepEqual(buildLeadEditorPatch(saved, form({ phone: '7165550199' })), {
      phone: '7165550199',
    });
    assert.deepEqual(buildLeadEditorPatch(saved, form({ name: 'New Name', city: 'Rochester' })), {
      name: 'New Name',
      city: 'Rochester',
    });
  });

  it('fills a missing optional field without resending the rest', () => {
    const { email, ...withoutEmail } = saved;
    void email;
    assert.deepEqual(buildLeadEditorPatch(withoutEmail, form()), { email: saved.email });
  });

  it('clears an optional field instead of writing a full document', () => {
    assert.deepEqual(buildLeadEditorPatch(saved, form({ phone: '', notes: '' })), {
      phone: null,
      notes: null,
    });
    assert.deepEqual(buildLeadEditorPatch(saved, form({ estimatedBill: '' })), {
      estimatedBill: null,
    });
  });

  it('keeps a zero bill and can set one', () => {
    assert.deepEqual(buildLeadEditorPatch({ ...saved, estimatedBill: 0 }, form({ estimatedBill: '0' })), {});
    assert.deepEqual(buildLeadEditorPatch({ ...saved, estimatedBill: null }, form({ estimatedBill: '0' })), {
      estimatedBill: 0,
    });
    assert.deepEqual(buildLeadEditorPatch({ ...saved, estimatedBill: null }, form({ estimatedBill: '180.5' })), {
      estimatedBill: 180.5,
    });
  });
});
