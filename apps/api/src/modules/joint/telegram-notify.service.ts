import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);

  constructor(private readonly config: ConfigService) {}

  private token() {
    const t = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!t || t === 'your_bot_token_here') return null;
    return t;
  }

  async sendMessage(
    telegramId: bigint | number | string,
    text: string,
    replyMarkup?: unknown,
  ): Promise<number | null> {
    const token = this.token();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN missing — skip notify');
      return null;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(telegramId),
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!data.ok) {
        this.logger.warn(`sendMessage failed: ${data.description}`);
        return null;
      }
      return data.result?.message_id ?? null;
    } catch (err) {
      this.logger.error('sendMessage error', err);
      return null;
    }
  }

  async editMessage(
    telegramId: bigint | number | string,
    messageId: number,
    text: string,
  ) {
    const token = this.token();
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(telegramId),
          message_id: messageId,
          text,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      this.logger.error('editMessage error', err);
    }
  }

  async sendPhoto(
    telegramId: bigint | number | string,
    photoUrl: string,
    caption: string,
    replyMarkup?: unknown,
  ): Promise<number | null> {
    const token = this.token();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN missing — skip photo');
      return null;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(telegramId),
          photo: photoUrl,
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!data.ok) {
        this.logger.warn(`sendPhoto failed: ${data.description}`);
        return null;
      }
      return data.result?.message_id ?? null;
    } catch (err) {
      this.logger.error('sendPhoto error', err);
      return null;
    }
  }

  /**
   * Prepares an inline message the Mini App can share via WebApp.shareMessage
   * (native chat picker). See Bot API savePreparedInlineMessage.
   */
  async savePreparedInlineMessage(
    telegramUserId: bigint | number | string,
    result: Record<string, unknown>,
    opts?: {
      allowUserChats?: boolean;
      allowBotChats?: boolean;
      allowGroupChats?: boolean;
      allowChannelChats?: boolean;
    },
  ): Promise<string | null> {
    const token = this.token();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN missing — skip prepared message');
      return null;
    }
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/savePreparedInlineMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: Number(telegramUserId),
            result,
            allow_user_chats: opts?.allowUserChats ?? true,
            allow_bot_chats: opts?.allowBotChats ?? false,
            allow_group_chats: opts?.allowGroupChats ?? true,
            allow_channel_chats: opts?.allowChannelChats ?? true,
          }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        result?: { id: string; expiration_date?: number };
        description?: string;
      };
      if (!data.ok || !data.result?.id) {
        this.logger.warn(
          `savePreparedInlineMessage failed: ${data.description}`,
        );
        return null;
      }
      return data.result.id;
    } catch (err) {
      this.logger.error('savePreparedInlineMessage error', err);
      return null;
    }
  }
}
