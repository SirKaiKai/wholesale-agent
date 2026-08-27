import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '批发通 · 批发业务 Agent',
  description: '从零搭建的批发业务 Agent：RAG 文档 + 查询工具双通道',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
