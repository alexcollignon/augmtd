// Full-screen override — the builder gets no surrounding shell,
// just like a standalone page. The parent studio layout is bypassed here.
export default function StudioEditLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
