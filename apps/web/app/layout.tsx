export const metadata = {
  title: "Clipforge",
  description: "Private AI clipping studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0c11", color: "#eef1f6",
        fontFamily: "Inter, system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
