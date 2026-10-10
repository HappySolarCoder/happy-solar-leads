export function fakeAdmin() {
  const records = new Map<
    string,
    { value: Record<string, any>; revision: number }
  >();
  let revision = 0;
  const reads: string[] = [],
    writes: string[] = [],
    authCalls: string[] = [];
  const authUsers = new Set<string>();
  const errors = { authDelete: false, commit: false };
  const seed = (path: string, value: Record<string, any>) => {
    records.set(path, { value: structuredClone(value), revision: ++revision });
  };
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1),
    get: async () => snap(path),
  });
  const snap = (path: string) => {
    reads.push(path);
    const r = records.get(path);
    return {
      id: path.split("/").at(-1)!,
      ref: ref(path),
      exists: !!r,
      data: () => (r ? structuredClone(r.value) : undefined),
      updateTime: r ? { seconds: r.revision, nanoseconds: 0 } : undefined,
    };
  };
  function collection(name: string, filters: any[] = [], cap = Infinity) {
    const q = {
      doc: (id: string) => ref(`${name}/${id}`),
      where: (...f: any[]) => collection(name, [...filters, f], cap),
      limit: (n: number) => collection(name, filters, n),
      select: () => q,
      get: async () => {
        reads.push(`query:${name}`);
        const docs = [...records.keys()]
          .filter((p) => p.startsWith(name + "/"))
          .map(snap)
          .filter((d) =>
            filters.every(([f, op, v]) =>
              op === "=="
                ? d.data()![f] === v
                : op === ">="
                ? d.data()![f] >= v
                : d.data()![f] <= v
            )
          )
          .slice(0, cap);
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
    return q;
  }
  const db = {
    collection,
    runTransaction: async (fn: any) => {
      const queue: (() => void)[] = [];
      const tx = {
        get: async (r: any) => r.get(),
        getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
        set: (r: any, d: any) =>
          queue.push(() => {
            writes.push(r.path);
            seed(r.path, d);
          }),
        update: (r: any, d: any) =>
          queue.push(() => {
            writes.push(r.path);
            seed(r.path, { ...records.get(r.path)!.value, ...d });
          }),
        delete: (r: any) =>
          queue.push(() => {
            writes.push(r.path);
            records.delete(r.path);
          }),
        create: (r: any, d: any) =>
          queue.push(() => {
            writes.push(r.path);
            seed(r.path, d);
          }),
      };
      const result = await fn(tx);
      if (errors.commit)
        throw Object.assign(Error("Test commit failure"), { status: 503 });
      queue.forEach((f) => f());
      return result;
    },
  };
  const auth = {
    verifyIdToken: async (token: string, revoked: boolean) => {
      if (token === "bad" || !revoked) throw Error("Invalid token");
      return { uid: token };
    },
    updateUser: async (uid: string) => {
      authCalls.push(`disable:${uid}`);
    },
    revokeRefreshTokens: async (uid: string) => {
      authCalls.push(`revoke:${uid}`);
    },
    deleteUser: async (uid: string) => {
      authCalls.push(`delete:${uid}`);
      if (errors.authDelete)
        throw Object.assign(Error("Simulated Auth outage"), { status: 503 });
      if (!authUsers.has(uid))
        throw Object.assign(Error("Missing auth user"), {
          code: "auth/user-not-found",
        });
      authUsers.delete(uid);
    },
  };
  return {
    records,
    reads,
    writes,
    authCalls,
    authUsers,
    errors,
    seed,
    db,
    auth,
  };
}
