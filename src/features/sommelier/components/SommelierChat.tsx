import { useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FloatingChatButton } from './FloatingChatButton';
import { ChatWindow } from './ChatWindow';
import { useSommelierChat } from '../hooks/useSommelierChat';
import { runtimeSend } from '../lib/runtimeSend';
import { useAuth } from '@/features/auth/AuthContext';
import type { PreparedChatImage } from '../lib/chatImages';
import type { SendToSommelier } from '../types';

interface SommelierChatProps {
  /** 問い合わせの実装。既定はデプロイ済み AgentCore Runtime の呼び出し */
  send?: SendToSommelier;
}

/**
 * どの画面からでも呼び出せるソムリエ相談 UI。
 * 開閉ボタンとチャットウィンドウをまとめて提供する。
 */
export function SommelierChat({ send = runtimeSend }: SommelierChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 表示用の会話とセッション ID は端末に保存するため、同じ端末を別アカウントで
  // 使っても前の利用者の相談内容や会話の続きに触れないようユーザー単位で分ける
  const { user } = useAuth();
  const { messages, isResponding, sendMessage, stop, reset } =
    useSommelierChat(send, user?.userId ?? '');

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleSend = useCallback(
    (prompt: string, images: PreparedChatImage[]) => {
      void sendMessage(prompt, images);
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
