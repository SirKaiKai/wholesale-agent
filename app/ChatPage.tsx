'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState } from 'react';

type Capability = 'tool' | 'kb' | 'mix';

type Example = {
  title: string;
  channel: Capability;        // 该问题会走哪个通道
  hint?: string;              // 鼠标悬停的简短解释（可选）
};

// ===== Step 5 真实能力标签（与 lib/tool.ts + knowledge-base 一一对应）=====
const CAPABILITIES = [
  { key: 'tool', label: '工具', desc: '查客户欠款 / 库存 / 订单' },
  { key: 'kb',   label: '知识库', desc: '退货 / 账期 / 客户等级制度' },
  { key: 'mix',  label: '混合', desc: '工具 + 知识库联动回答' },
] as const;

// ===== 示例问题（按通道分组，每条对应一个真实能力）=====
const EXAMPLES: Example[] = [
  // 工具通道（3）
  { title: '张三欠了多少货款？', channel: 'tool', hint: '走 getCustomerDebt → 查 mock customers API' },
  { title: '农夫山泉550ml 还有多少库存？', channel: 'tool', hint: '走 getStock → 查 mock products API' },
  { title: '上个月谁的订单金额最大？', channel: 'tool', hint: '走 getOrders（不传客户名拿全量） → 查 mock orders API' },

  // 知识库通道（2）
  { title: '咱们公司的退货政策是什么？', channel: 'kb', hint: '走 RAG 检索 → 命中 return-policy.md' },
  { title: '客户账期超期了，按公司规定怎么处理？', channel: 'kb', hint: '走 RAG 检索 → 命中 credit-policy.md' },

  // 混合通道（2）
  { title: '张三欠款情况怎么样？按公司政策该怎么跟进？', channel: 'mix', hint: '工具查欠款 + RAG 查催款流程 → 一次性联动' },
  { title: '李四是什么等级客户？有什么待遇？', channel: 'mix', hint: '工具查等级 + RAG 查等级制度 → 数据+规则一起答' },
];

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages, stop } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  function speedyText(text: string) {
    return () => {
      handleInputChange({ target: { value: text } } as any);
      setTimeout(() => {
        const form = document.querySelector('.input-area') as HTMLFormElement;
        form?.requestSubmit();
      }, 0);
    };
  }

  function clearMessage() {
    return () => {
      stop();
      setMessages([]);
    };
  }

  // 通道对应的 chip class（颜色在 globals.css 里定义）
  const channelLabel: Record<Capability, string> = {
    tool: '工具',
    kb: '知识库',
    mix: '混合',
  };

  return (
    <div className="app">
      <header className="header">
        <div className="left">
          <span className="dot" />
          <h1>批发通 · 批发业务 Agent</h1>
        </div>
        {messages.length > 0 && (
          <div className="clear" onClick={clearMessage()}>
            清空对话
          </div>
        )}
      </header>

      {/* 能力标签条：可视化展示当前 Agent 已具备的能力版图 */}
      <div className="capability-bar">
        {CAPABILITIES.map((c) => (
          <div key={c.key} className={`cap-chip cap-${c.key}`} title={c.desc}>
            <span className="cap-dot" />
            <span className="cap-label">{c.label}</span>
            <span className="cap-desc">{c.desc}</span>
          </div>
        ))}
      </div>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-hint">
            <p className="stage-title">双通道 Agent</p>
            <p className="stage-sub">3 个查询工具 + 3 个知识库文档，工具与文档联动回答</p>
            <div className="examples">
              {EXAMPLES.map((item, index) => (
                <div
                  key={index}
                  className={`example channel-${item.channel}`}
                  onClick={speedyText(item.title)}
                  title={item.hint}
                >
                  <span className={`channel-tag tag-${item.channel}`}>{channelLabel[item.channel]}</span>
                  <span className="example-title">{item.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role === 'user' ? 'user' : 'assistant'} ${message.content ? '' : 'notCont'}`}
          >
            {message.content}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="message assistant">正在思考...</div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <form className="input-area" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={handleInputChange}
          placeholder="输入消息，回车发送..."
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={!input.trim() || isLoading}>
          发送
        </button>
      </form>
    </div>
  );
}