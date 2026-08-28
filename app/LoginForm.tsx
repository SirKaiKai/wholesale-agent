// app/LoginForm.tsx —— 登录表单组件（被 app/page.tsx 在未登录态时调用）
// 替代原本独立的 /login 路由：避免 EdgeOne Pages 预览链接下
// middleware 重定向 / → /login 触发边缘层重写循环。
'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      // 整页刷新，确保 cookie 生效后 /api/me 重新判断为 loggedIn
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || '密码错误');
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f6f8',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          padding: '40px 32px',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 8, textAlign: 'center' }}>
          批发通 · Agent 后台
        </h1>
        <p
          style={{
            fontSize: 13,
            color: '#888',
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          请输入访问密码进入系统
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="访问密码"
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #ddd',
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 0',
            background: '#4f46e5',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '登录中…' : '进入系统'}
        </button>
        {error && (
          <p
            style={{
              color: '#dc2626',
              fontSize: 13,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}
      </form>
    </main>
  );
}