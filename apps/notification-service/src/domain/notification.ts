/**
 * Notification — the in-app notification entity (the "bell" record).
 *
 * Created by the NotificationDispatcher when a business event (e.g. an alarm)
 * occurs. Each notification is scoped to a user (or null for broadcast).
 * The `sourceType` + `sourceId` pair provides idempotency — a duplicate event
 * for the same source does NOT create a duplicate notification.
 */
import { randomUUID } from 'node:crypto';
import type { NotificationCategory, NotificationSeverity } from './notification-types.js';

export interface NotificationProps {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  title: string;
  body: string;
  readonly link: string | null;
  read: boolean;
  readAt: Date | null;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly createdAt: Date;
}

export class Notification {
  public readonly tenantId: string;
  public readonly userId: string | null;
  public readonly category: NotificationCategory;
  public readonly severity: NotificationSeverity;
  public title: string;
  public body: string;
  public readonly link: string | null;
  public read: boolean;
  public readAt: Date | null;
  public readonly sourceType: string;
  public readonly sourceId: string | null;
  public readonly createdAt: Date;
  public readonly id: string;

  private constructor(id: string, props: NotificationProps) {
    this.id = id;
    this.tenantId = props.tenantId;
    this.userId = props.userId;
    this.category = props.category;
    this.severity = props.severity;
    this.title = props.title;
    this.body = props.body;
    this.link = props.link;
    this.read = props.read;
    this.readAt = props.readAt;
    this.sourceType = props.sourceType;
    this.sourceId = props.sourceId;
    this.createdAt = props.createdAt;
  }

  public static create(
    id: string | undefined,
    props: Omit<NotificationProps, 'read' | 'readAt' | 'createdAt'>,
  ): Notification {
    return new Notification(id ?? randomUUID(), {
      ...props,
      read: false,
      readAt: null,
      createdAt: new Date(),
    });
  }

  public static rehydrate(id: string, props: NotificationProps): Notification {
    return new Notification(id, props);
  }

  public markRead(): void {
    if (this.read) return;
    this.read = true;
    this.readAt = new Date();
  }
}
