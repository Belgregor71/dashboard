export function GridLayout({ children }) {
  return <main style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>{children}</main>;
}
