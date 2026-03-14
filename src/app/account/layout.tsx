import AppNav from "@/components/AppNav";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main>{children}</main>
    </div>
  );
}
