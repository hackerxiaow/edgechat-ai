<script setup>
import { computed, ref, toRef } from 'vue';
import { isCapacitorAndroid, pickNativeFile } from '../../capacitor-platform.ts';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { t } from '../../i18n.js';
import UiAvatar from '../ui/Avatar.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  room: { type: Object, default: null },
  form: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  avatarUploading: { type: Boolean, default: false },
  members: { type: Array, default: () => [] },
  transferring: { type: Boolean, default: false }
});

const emit = defineEmits([
  'close',
  'upload-avatar',
  'save',
  'delete-group',
  'leave-group',
  'transfer-owner'
]);
const avatarInput = ref(null);
const nameInputEl = ref(null);
const pickerError = ref('');
const transferTarget = ref('');

const isOwner = computed(() => props.room?.myRole === 'owner');
const memberCount = computed(() => props.members.length);
// 转让对象不能是自己，也不能是当前群主
const transferCandidates = computed(() =>
  props.members.filter(
    (member) => member.role !== 'owner' && Number(member.id) !== Number(props.room?.ownerUserId)
  )
);
const createdLabel = computed(() => {
  const raw = String(props.room?.createdAt || '').trim();
  if (!raw) return t('group.unknownCreatedAt');
  // D1 的 CURRENT_TIMESTAMP 是不带时区的 UTC 字符串，显式按 UTC 解析
  const date = new Date(`${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: nameInputEl
});

async function openAvatarPicker() {
  pickerError.value = '';
  if (!isCapacitorAndroid) {
    avatarInput.value?.click();
    return;
  }

  try {
    const file = await pickNativeFile('image/*');
    if (file) emit('upload-avatar', file);
  } catch {
    pickerError.value = t('chat.fileSelectionFailed');
  }
}
</script>

<template>
  <Teleport to="body">
  <Transition name="modal-fade">
    <div v-if="show" class="room-dialog-overlay" @click.self="emit('close')">
      <section class="room-dialog" role="dialog" aria-modal="true" aria-labelledby="group-settings-title">
        <h2 id="group-settings-title">{{ t('group.settings') }}</h2>

        <div class="room-dialog__avatar-row">
          <UiAvatar :src="form.avatarUrl" :fallback="room?.name?.[0] || '?'" />
          <input ref="avatarInput" type="file" class="room-dialog__file" accept="image/*" @change="emit('upload-avatar', $event)" />
          <button type="button" class="room-dialog__secondary" :disabled="avatarUploading" @click="openAvatarPicker">
            {{ avatarUploading ? t('common.uploading') : t('group.changeAvatar') }}
          </button>
        </div>
        <p v-if="pickerError" class="room-dialog__error" role="alert">{{ pickerError }}</p>

        <label class="room-dialog__field">
          <span>{{ t('group.nameGeneric') }}</span>
          <input ref="nameInputEl" v-model="form.name" type="text" class="room-dialog__input" :disabled="room?.isGeneral" />
        </label>

        <label class="room-dialog__field">
          <span>{{ t('group.description') }}</span>
          <textarea
            v-model="form.description"
            class="room-dialog__input room-dialog__textarea"
            rows="3"
            maxlength="500"
            :disabled="room?.isGeneral"
            :placeholder="t('group.descriptionPlaceholder')"
          ></textarea>
        </label>

        <!-- 群组信息页要展示的元信息 -->
        <dl class="room-dialog__meta">
          <div>
            <dt>{{ t('group.memberCount') }}</dt>
            <dd>{{ memberCount }}</dd>
          </div>
          <div>
            <dt>{{ t('group.createdAt') }}</dt>
            <dd>{{ createdLabel }}</dd>
          </div>
        </dl>

        <!-- 群主转让：仅群主可见，列出现有成员 -->
        <label v-if="room && !room.isGeneral && isOwner && transferCandidates.length" class="room-dialog__field">
          <span>{{ t('group.transferOwner') }}</span>
          <select class="room-dialog__input" :value="transferTarget" @change="transferTarget = $event.target.value">
            <option value="">{{ t('group.transferOwnerPlaceholder') }}</option>
            <option v-for="member in transferCandidates" :key="member.id" :value="member.id">
              {{ member.displayName }} @{{ member.username }}
            </option>
          </select>
          <button
            type="button"
            class="room-dialog__secondary"
            :disabled="!transferTarget || transferring"
            @click="emit('transfer-owner', Number(transferTarget))"
          >
            {{ transferring ? t('common.saving') : t('group.transferOwnerAction') }}
          </button>
        </label>

        <div v-if="room && !room.isGeneral" class="room-dialog__danger-zone">
          <button v-if="room.canManage" type="button" class="room-dialog__danger" @click="emit('delete-group')">
            {{ t('group.delete') }}
          </button>
          <!-- 群主必须先转让或删除群组，因此不给退出入口 -->
          <button v-if="!isOwner" type="button" class="room-dialog__danger" @click="emit('leave-group')">
            {{ t('group.leave') }}
          </button>
        </div>

        <div class="room-dialog__actions">
          <button type="button" class="room-dialog__secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="room-dialog__primary" :disabled="!form.name.trim() || saving" @click="emit('save')">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </section>
    </div>
  </Transition>
  </Teleport>
</template>

<style scoped>
.room-dialog__textarea {
  resize: vertical;
  min-height: 72px;
  font: inherit;
}

.room-dialog__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.room-dialog__meta dt {
  font-size: 0.78rem;
  opacity: 0.7;
}

.room-dialog__meta dd {
  margin: 4px 0 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.room-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.4);
}
.room-dialog { width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); }
.room-dialog h2 { margin: 0 0 20px; font-size: 18px; color: #111b21; }
.room-dialog__avatar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.room-dialog__file { display: none; }
.room-dialog__error { margin: -12px 0 16px; color: #b42318; font-size: 13px; }
.room-dialog__field { display: grid; gap: 8px; color: #6b7c93; font-size: 13px; }
.room-dialog__input { width: 100%; min-height: 44px; padding: 10px 14px; border: 1px solid #e8ecf0; border-radius: 8px; background: #f9fafb; font-size: 16px; }
.room-dialog__actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
.room-dialog__secondary, .room-dialog__primary { min-height: 44px; padding: 10px 20px; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
.room-dialog__secondary { border: 1px solid #e8ecf0; background: #fff; }
.room-dialog__primary { border: 0; background: #008069; color: #fff; }
.room-dialog__primary:disabled, .room-dialog__secondary:disabled { cursor: not-allowed; opacity: 0.55; }
.room-dialog__danger-zone { margin-top: 20px; padding-top: 16px; border-top: 1px solid #f2f4f7; }
.room-dialog__danger { width: 100%; min-height: 44px; padding: 10px 16px; border: 1px solid #fee4e2; border-radius: 8px; background: #fef3f2; color: #d92d20; font-weight: 500; cursor: pointer; }
.room-dialog__danger:hover { background: #fee4e2; }
.modal-fade-enter-active { transition: opacity 200ms; }
.modal-fade-leave-active { transition: opacity 150ms; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .room-dialog-overlay {
    align-items: flex-end;
    padding: env(safe-area-inset-top) 0 0;
  }

  .room-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top));
    padding: 20px 16px max(16px, env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
  }

  .room-dialog__avatar-row {
    flex-wrap: wrap;
  }

  .room-dialog__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
