import { redirect } from 'next/navigation';

// ONE LIBRARY, ONE ADDRESS: every old door lands on /documents directly — never a redirect chain.
export default function KnowledgePage() {
  redirect('/documents');
}
