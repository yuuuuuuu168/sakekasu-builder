import { useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FloatingChatButton } from './FloatingChatButton';
import { ChatWindow } from './ChatWindow';
import { useSommelierChat } from '../hooks/useSommelierChat';
import { stubSend } from '../lib/stubSend';
import { useAuth } from '@/features/auth/AuthContext';
import type { SendToSommelier } from '../types';

interface SommelierChatProps {
  /**
   * 問い合わせの実装。既定は Runtime 接続前のスタブ。
   * ロードマップ #5 で AgentCore Runtime を呼ぶ実装を渡す。
   */
  send?: SendToSommelier;
}

/**
 * どの画面からでも呼び出せるソムリエ相談 UI。
 * 開閉ボタンとチャットウィンドウをまとめて提供する。
 */
export function SommelierChat({ send = stubSend }: SommelierChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 履歴は端末に保存するため、同じ端末を別アカウントで使っても
  // 前の利用者の相談内容が見えないようユーザー単位で分ける
  const { user } = useAuth();
  const { messages, isResponding, sendMessage, stop, reset } =
    useSommelierChat(send, user?.userId ?? '');

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleSend = useCallback(
    (prompt: string) => {
      void sendMessage(prompt);
    },
    [sendMessage],
  );

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <ChatWindow
            messages={messages}
            isResponding={isResponding}
            onSend={handleSend}
            onStop={stop}
            onReset={reset}
            onClose={close}
          />
        )}
      </AnimatePresence>
      <FloatingChatButton isOpen={isOpen} onClick={toggle} />
    </>
  );
}
