"use client";
import { useRef } from "react";
import UsersWorkspace, {
  type UsersData,
  type UsersRequest,
} from "../UsersWorkspace";
const initialData: UsersData = {
  actorId: "demo-admin",
  users: [
    {
      id: "demo-admin",
      name: "Alex Admin",
      email: "admin@example.invalid",
      role: "admin",
      team: "Demo",
      isActive: true,
      deleted: false,
      deletionPending: false,
      version: "1",
    },
    ...Array.from({ length: 180 }, (_, i) => ({
      id: `demo-${i}`,
      name: `Sample Rep ${String(i + 1).padStart(3, "0")}`,
      email: `rep${i + 1}@example.invalid`,
      role: "setter",
      team: i % 2 ? "Buffalo" : "Rochester",
      isActive: true,
      deleted: false,
      deletionPending: false,
      version: "1",
    })),
  ],
};
export default function UsersPreview() {
  const data = useRef(structuredClone(initialData));
  const request: UsersRequest = async <T,>(body?: Record<string, unknown>) => {
    if (!body) return structuredClone(data.current) as T;
    data.current.users = data.current.users.filter((u) => u.id !== body.userId);
    return { done: true, removed: 2 } as T;
  };
  return <UsersWorkspace initialData={initialData} request={request} preview />;
}
