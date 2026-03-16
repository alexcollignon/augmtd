import { redirect } from 'next/navigation';

// Company management has moved to Settings > Company tab
export default function CompanyPage() {
  redirect('/settings?tab=company');
}
