import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStorageRows,
  formatByteSize,
  mergeStorageSummary,
  sortStorageRows
} from '../frontend/src/storage-statistics.js';
import {
  storageOwnerFromUserId,
  summarizeUploadedFiles
} from '../worker/src/storage-statistics.ts';
import { registerAdminRoutes } from '../worker/src/api/admin.ts';

function storageScanHandler() {
  let handler;
  const app = {
    get(path, candidate) {
      if (path === '/api/admin/storage/scan') handler = candidate;
    },
    patch() {},
    post() {},
    delete() {}
  };
  registerAdminRoutes(app);
  return handler;
}

test('uploaded file owners resolve to a user or an unknown owner', () => {
  assert.deepEqual(storageOwnerFromUserId(12), {
    key: 'user:12',
    type: 'user',
    userId: 12
  });
  assert.deepEqual(storageOwnerFromUserId(0), {
    key: 'system:unknown',
    type: 'unknown',
    userId: null
  });
  assert.deepEqual(storageOwnerFromUserId(null), {
    key: 'system:unknown',
    type: 'unknown',
    userId: null
  });
});

test('aggregated uploaded_files rows are summarised without exposing object keys', () => {
  const items = summarizeUploadedFiles([
    { owner_user_id: 2, object_count: 2, bytes: 350, latest_uploaded_at: '2026-08-12 00:00:00' },
    { owner_user_id: 0, object_count: 1, bytes: 50, latest_uploaded_at: '2026-08-10 00:00:00' }
  ]);

  assert.deepEqual(items, [
    {
      ownerKey: 'user:2',
      ownerType: 'user',
      ownerId: 2,
      objectCount: 2,
      bytes: 350,
      latestUploadedAt: '2026-08-12T00:00:00.000Z'
    },
    {
      ownerKey: 'system:unknown',
      ownerType: 'unknown',
      ownerId: null,
      objectCount: 1,
      bytes: 50,
      latestUploadedAt: '2026-08-10T00:00:00.000Z'
    }
  ]);
  assert.equal('key' in items[0], false);
});

test('storage scan aggregates uploaded_files directly in D1', async () => {
  const response = await storageScanHandler()({
    env: {
      DB: {
        prepare(sql) {
          return {
            bind() {
              return this;
            },
            async all() {
              return sql.includes('FROM uploaded_files')
                ? {
                    results: [
                      {
                        owner_user_id: 3,
                        object_count: 2,
                        bytes: 300,
                        latest_uploaded_at: '2026-08-12 00:00:00'
                      }
                    ]
                  }
                : {
                    results: [
                      { id: 3, username: 'three', display_name: 'Three', deleted_at: null }
                    ]
                  };
            }
          };
        }
      }
    },
    req: { url: 'https://edgechat.example/api/admin/storage/scan' },
    header() {},
    json(body) {
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.truncated, false);
  assert.equal(payload.cursor, null);
  assert.equal(payload.scannedObjects, 2);
  assert.deepEqual(payload.items, [
    {
      ownerKey: 'user:3',
      ownerType: 'user',
      ownerId: 3,
      objectCount: 2,
      bytes: 300,
      latestUploadedAt: '2026-08-12T00:00:00.000Z'
    }
  ]);
  assert.equal(payload.users.length, 1);
});

test('paged summaries merge and include active zero-usage users', () => {
  const summaries = new Map();
  mergeStorageSummary(summaries, [
    {
      ownerKey: 'user:1',
      ownerType: 'user',
      ownerId: 1,
      objectCount: 1,
      bytes: 10,
      latestUploadedAt: '2026-08-11T00:00:00Z'
    }
  ]);
  mergeStorageSummary(summaries, [
    {
      ownerKey: 'user:1',
      ownerType: 'user',
      ownerId: 1,
      objectCount: 2,
      bytes: 20,
      latestUploadedAt: '2026-08-12T00:00:00Z'
    }
  ]);

  const rows = buildStorageRows(
    [
      { id: 1, username: 'one', displayName: 'One', isDeleted: false },
      { id: 2, username: 'two', displayName: 'Two', isDeleted: false }
    ],
    summaries
  );
  assert.equal(rows.find((row) => row.ownerKey === 'user:1').bytes, 30);
  assert.equal(rows.find((row) => row.ownerKey === 'user:1').objectCount, 3);
  assert.equal(rows.find((row) => row.ownerKey === 'user:2').bytes, 0);
  assert.equal(rows.find((row) => row.ownerKey === 'user:1').share, 1);
});

test('storage rows sort numerically and missing upload times stay last', () => {
  const rows = [
    { displayName: 'A', bytes: 2, objectCount: 2, share: 0.2, latestUploadedAt: null },
    {
      displayName: 'B',
      bytes: 10,
      objectCount: 1,
      share: 0.8,
      latestUploadedAt: '2026-08-12T00:00:00Z'
    }
  ];
  assert.deepEqual(
    sortStorageRows(rows, { key: 'bytes', direction: 'desc' }).map((row) => row.displayName),
    ['B', 'A']
  );
  assert.deepEqual(
    sortStorageRows(rows, { key: 'objectCount', direction: 'desc' }).map(
      (row) => row.displayName
    ),
    ['A', 'B']
  );
  assert.deepEqual(
    sortStorageRows(rows, { key: 'latestUploadedAt', direction: 'asc' }).map(
      (row) => row.displayName
    ),
    ['B', 'A']
  );
  assert.equal(formatByteSize(10 * 1024 * 1024), '10.0 MiB');
});
