import { redirect } from 'next/navigation';

// Status lives as a TAB inside platform-admin (the left nav must never vanish —
// owner feedback, Sep 1). This route survives as the deep link.
export default function PlatformStatusPage() {
  redirect('/platform-admin?tab=status');
}
