import { onBeforeUnmount, onMounted } from 'vue';
import api from '../api.js';

/** 心跳间隔略小于服务端的在线窗口（90 秒），避免边界上闪断。 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * 在线心跳：进入应用后立即上报一次，之后每分钟一次。
 * 服务端会再做一次去重写入，因此实际 D1 写入远低于此频率。
 */
export function usePresence() {
  let timer = null;

  function beat() {
    void api.sendPresence().catch(() => {});
  }

  onMounted(() => {
    beat();
    timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });
}
