import { NextRequest } from "next/server";
import { createTerritoryHandlers } from "../../../app/utils/server/territoryManagement";
// In-memory adapter runs the real route handlers. No Firebase credentials/network.
export function fixture() {
  const records = new Map<
    string,
    { value: Record<string, any>; revision: number }
  >();
  let revision = 0,
    failCommit = false;
  const seed = (path: string, value: Record<string, any>) =>
    records.set(path, { value: structuredClone(value), revision: ++revision });
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1),
    get: async () => snap(path),
  });
  const snap = (path: string) => {
    const d = records.get(path);
    return {
      id: path.split("/").at(-1),
      ref: ref(path),
      exists: !!d,
      data: () => (d ? structuredClone(d.value) : undefined),
      updateTime: d ? { seconds: d.revision, nanoseconds: 0 } : undefined,
    };
  };
  function collection(name: string, filters: any[] = [], cap = Infinity, orders: string[] = [], after: any[] = []) {
    const q = {
      doc: (id: string) => ref(`${name}/${id}`),
      where: (...f: any[]) => collection(name, [...filters, f], cap, orders, after),
      limit: (n: number) => collection(name, filters, n, orders, after),
      select: () => q,
      orderBy: (field: any) => collection(name, filters, cap, [...orders, typeof field==='string'?field:'__name__'], after),
      startAfter: (...values: any[]) => collection(name, filters, cap, orders, values),
      get: async () => {
        const docs = [...records.keys()]
          .filter((p) => p.startsWith(`${name}/`))
          .map(snap)
          .filter((d) =>
            filters.every(([field, op, val]) =>
              op === ">=" ? d.data()![field] >= val : op === "<=" ? d.data()![field] <= val : d.data()![field] === val
            )
          )
          .sort((a,b)=>{for(const key of orders){const av=key==='__name__'?a.id:a.data()![key],bv=key==='__name__'?b.id:b.data()![key];if(av!==bv)return av<bv?-1:1;}return 0;})
          .filter(d=>{if(!after.length)return true;for(let i=0;i<orders.length;i++){const value=orders[i]==='__name__'?d.id:d.data()![orders[i]];if(value!==after[i])return value>after[i];}return false;})
          .slice(0, cap);
        return { docs, size: docs.length };
      },
    };
    return q;
  }
  const db = {
    collection,
    runTransaction: async (fn: any) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: any) => { if(writes.length)throw Error("Transaction read after write");return r.get(); },
        getAll: async (...refs: any[]) => { if(writes.length)throw Error("Transaction read after write");return Promise.all(refs.map((r) => r.get())); },
        update: (r: any, d: any) =>
          writes.push(() =>
            seed(r.path, { ...records.get(r.path)!.value, ...d })
          ),
        create: (r: any, d: any) => writes.push(() => seed(r.path, d)),
        set: (r: any, d: any) => writes.push(() => seed(r.path, d)),
        delete: (r: any) => writes.push(() => records.delete(r.path)),
      };
      const result = await fn(tx);
      if (failCommit)
        throw Object.assign(new Error("Simulated failure"), { status: 503 });
      writes.forEach((w) => w());
      return result;
    },
  };
  seed("users/manager", { name: "Manager", role: "manager", team: "A" });
  seed("users/rep", { name: "Rep", role: "setter", team: "A" });
  seed("users/next", { name: "Next", role: "setter", team: "A" });
  seed("users/outsider", { name: "Other", role: "setter", team: "B" });
  seed("users/admin", { name: "Admin", role: "admin" });
  const handlers = createTerritoryHandlers({
    adminDb: () => db,
    adminAuth: () => ({
      verifyIdToken: async (token: string) => {
        if (token === "bad") throw Error();
        return { uid: token };
      },
    }),
  } as unknown as Parameters<typeof createTerritoryHandlers>[0]);
  const request = async (body?: Record<string, unknown>, actor = "manager") => {
    const req = new NextRequest(
      "https://example.com/api/territory-management",
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${actor}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
    const result = await (body ? handlers.POST(req) : handlers.GET(req));
    return { status: result.status, body: await result.json() };
  };
  return {
    request,
    db,
    seed,
    records,
    setFailure: (v: boolean) => {
      failCommit = v;
    },
  };
}
