// app/page.tsx —— 根路径入口（零重定向）
// 在 EdgeOne Pages 预览链接下，middleware 不能再重定向 / 到 /login，
// 否则 EdgeOne 边缘层对 Location 重写会触发死循环。
// 改成在这里按登录态直接渲染 LoginForm 或 ChatPage。
'use client';

import { useEffect, useState } from 'react';
import ChatPage from './ChatPage';
import LoginForm from './LoginForm';

type Status = 'loading' | 'in' | 'out';

export default function Page() {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    // 双重兜底：即使 fetch 完全没触发或 JS 加载极慢，6 秒后强制显示登录页
    const forceShowLogin = setTimeout(() => {
      setStatus((s) => (s === 'loading' ? 'out' : s));
    }, 6000);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 5000); // 5 秒 fetch 超时

    fetch('/api/me', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setStatus(d.loggedIn ? 'in' : 'out'))
      .catch(() => setStatus('out'))
      .finally(() => {
        clearTimeout(abortTimer);
        clearTimeout(forceShowLogin);
      });

    return () => {
      clearTimeout(forceShowLogin);
      clearTimeout(abortTimer);
      controller.abort();
    };
  }, []);

  if (status === 'loading') {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f6f8',
          color: '#888',
          fontSize: 14,
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>加载中…</div>
        <div style={{ fontSize: 12, color: '#aaa' }}>若超过 6 秒未响应，将自动显示登录页</div>
      </main>
    );
  }

  return status === 'in' ? <ChatPage /> : <LoginForm />;
}