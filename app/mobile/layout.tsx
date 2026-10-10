import "./mobile.css";
import "../field/field.css";
import { MobileDataBoundary } from "./_components/MobileDataProvider";

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="raydar-mobile">
      <MobileDataBoundary>{children}</MobileDataBoundary>
    </div>
  );
}
