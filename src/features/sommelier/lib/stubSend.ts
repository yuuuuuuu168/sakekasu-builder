import type { SendToSommelier } from '../types';

/** スタブ応答の1文字あたりの遅延（ms）。ストリーミングの見え方を確認するため */
const CHUNK_DELAY_MS = 20;

const STUB_REPLY =
  'ただいま準備中です。AgentCore Runtime と接続すると、' +
  'あなたの購入記録をもとにおすすめをお答えします。';

/**
 * Runtime 接続前の仮実装。UI 単体で動作確認するために使う。
 *
 * ロードマップ #5 で AgentCore Runtime を呼び出す実装に差し替える。
 */
export const stubSend: SendToSommelier = async function* (_prompt, { signal }) {
  for (const char of STUB_REPLY) {
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    yield char;
  }
};
