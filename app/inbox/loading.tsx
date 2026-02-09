import SidebarNav from '@/components/sidebar-nav';

export default function Loading() {
  return (
    <div className="flex h-screen bg-gray-50">
      <SidebarNav userEmail="" />
      <main className="flex-1" />
    </div>
  );
}
