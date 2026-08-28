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
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setStatus(d.loggedIn ? 'in' : 'out'))
      .catch(() => setStatus('out'));
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
        }}
      >
        加载中…
      </main>
    );
  }

  return status === 'in' ? <ChatPage /> : <LoginForm />;
}