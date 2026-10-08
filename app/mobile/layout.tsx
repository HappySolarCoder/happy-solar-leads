import "./mobile.css";

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="raydar-mobile">{children}</div>;
}
