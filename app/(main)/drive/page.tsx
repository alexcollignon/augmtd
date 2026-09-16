import { redirect } from 'next/navigation';

// ONE LIBRARY, ONE ADDRESS (owner, Sep 15 — docs/documents-library-plan.md): the library is
// /documents. /drive survives only as a redirect, so old links keep landing somewhere true.
export default function DrivePage() {
  redirect('/documents');
}
