import { EventEmitter } from "events";
import { Logger } from "pino";
import {
  IClient,
  ISubscription,
  ISubscriptionTopicMap,
  Reason,
  SubscriptionEvent,
  SubscriptionActive,
  IRelayerStorage,
} from "@walletconnect/types";
import { ERROR, formatMessageContext } from "@walletconnect/utils";
import { generateChildLogger, getLoggerContext } from "@walletconnect/logger";

import { SUBSCRIPTION_CONTEXT, SUBSCRIPTION_EVENTS } from "../constants";

export class SubscriptionTopicMap implements ISubscriptionTopicMap {
  public map = new Map<string, string[]>();

  get topics(): string[] {
    return Array.from(this.map.keys());
  }

  public set(topic: string, id: string): void {
    const ids = this.get(topic);
    if (this.exists(topic, id)) return;
    this.map.set(topic, [...ids, id]);
  }

  public get(topic: string): string[] {
    const ids = this.map.get(topic);
    return ids || [];
  }

  public exists(topic: string, id: string): boolean {
    const ids = this.get(topic);
    return ids.includes(id);
  }

  public delete(topic: string, id?: string): void {
    if (typeof id === "undefined") {
      this.map.delete(topic);
      return;
    }
    if (!this.map.has(topic)) return;
    const ids = this.get(topic);
    if (!this.exists(topic, id)) return;
    const remaining = ids.filter(x => x !== id);
    if (!remaining.length) {
      this.map.delete(topic);
      return;
    }
    this.map.set(topic, remaining);
  }

  public clear(): void {
    this.map.clear();
  }
}

export class Subscription extends ISubscription {
  public subscriptions = new Map<string, SubscriptionActive>();

  public topicMap = new SubscriptionTopicMap();

  public events = new EventEmitter();

  public name: string = SUBSCRIPTION_CONTEXT;

  private cached: SubscriptionActive[] = [];

  constructor(public logger: Logger, public storage: IRelayerStorage) {
    super(logger, storage);
    this.logger = generateChildLogger(logger, this.name);
    this.storage = storage;
    this.registerEventListeners();
  }

  public async init(): Promise<void> {
    this.logger.trace(`Initialized`);
    await this.initialize();
  }

  get context(): string {
    return getLoggerContext(this.logger);
  }

  get length(): number {
    return this.subscriptions.size;
  }

  get ids(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  get values(): SubscriptionActive[] {
    return Array.from(this.subscriptions.values());
  }

  get topics(): string[] {
    return this.topicMap.topics;
  }

  public async set(id: string, subscription: SubscriptionActive): Promise<void> {
    await this.isEnabled();
    if (this.subscriptions.has(id)) return;
    this.logger.debug(`Setting subscription`);
    this.logger.trace({ type: "method", method: "set", id, subscription });
    this.setSubscription(id, subscription);
    this.events.emit(SUBSCRIPTION_EVENTS.created, subscription);
  }

  public async get(id: string): Promise<SubscriptionActive> {
    await this.isEnabled();
    this.logger.debug(`Getting subscription`);
    this.logger.trace({ type: "method", method: "get", id });
    const subscription = this.getSubscription(id);
    return subscription;
  }

  public async exists(id: string, topic: string): Promise<boolean> {
    await this.isEnabled();
    let result = false;
    try {
      const subscription = this.getSubscription(id);
      result = subscription.topic === topic;
    } catch (e) {
      // ignore error
    }
    return result;
  }

  public async delete(id: string, reason: Reason): Promise<void> {
    await this.isEnabled();
    this.logger.debug(`Deleting subscription`);
    this.logger.trace({ type: "method", method: "delete", id, reason });
    const subscription = this.getSubscription(id);
    this.deleteSubscription(id, subscription);
    this.events.emit(SUBSCRIPTION_EVENTS.deleted, {
      ...subscription,
      reason,
    } as SubscriptionEvent.Deleted);
  }

  public on(event: string, listener: any): void {
    this.events.on(event, listener);
  }

  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }

  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }

  public async enable(): Promise<void> {
    if (!this.cached.length) return;
    this.reset();
    this.onEnable();
  }

  public async disable(): Promise<void> {
    if (this.cached.length) return;
    this.onDisable();
  }

  // ---------- Private ----------------------------------------------- //

  private reset() {
    this.cached.map(async subscription => this.setSubscription(subscription.id, subscription));
  }

  private onEnable() {
    this.cached = [];
    this.events.emit(SUBSCRIPTION_EVENTS.enabled);
  }

  private onDisable() {
    this.cached = this.values;
    this.subscriptions.clear();
    this.topicMap.clear();
    this.events.emit(SUBSCRIPTION_EVENTS.disabled);
  }

  private setSubscription(id: string, subscription: SubscriptionActive): void {
    this.subscriptions.set(id, { ...subscription });
    this.topicMap.set(subscription.topic, id);
  }

  private getSubscription(id: string): SubscriptionActive {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      const error = ERROR.NO_MATCHING_ID.format({
        context: formatMessageContext(this.context),
        id,
      });
      // this.logger.error(error.message);
      throw new Error(error.message);
    }
    return subscription;
  }

  private deleteSubscription(id: string, subscription: SubscriptionActive): void {
    this.subscriptions.delete(id);
    this.topicMap.delete(subscription.topic, id);
  }

  private async persist() {
    await this.storage.setRelayerSubscriptions(this.context, this.values);
    this.events.emit(SUBSCRIPTION_EVENTS.sync);
  }

  private async restore() {
    try {
      const persisted = await this.storage.getRelayerSubscriptions(this.context);
      if (typeof persisted === "undefined") return;
      if (!persisted.length) return;
      if (this.subscriptions.size) {
        const error = ERROR.RESTORE_WILL_OVERRIDE.format({
          context: formatMessageContext(this.context),
        });
        this.logger.error(error.message);
        throw new Error(error.message);
      }
      this.cached = persisted;
      this.logger.debug(
        `Successfully Restored subscriptions for ${formatMessageContext(this.context)}`,
      );
      this.logger.trace({ type: "method", method: "restore", subscriptions: this.values });
    } catch (e) {
      this.logger.debug(
        `Failed to Restore subscriptions for ${formatMessageContext(this.context)}`,
      );
      this.logger.error(e as any);
    }
  }

  private async initialize() {
    await this.restore();
    this.reset();
    this.onInit();
  }

  private onInit() {
    this.onEnable();
  }

  private async isEnabled(): Promise<void> {
    if (!this.cached.length) return;
    return new Promise(resolve => {
      this.events.once(SUBSCRIPTION_EVENTS.enabled, () => resolve());
    });
  }

  private registerEventListeners(): void {
    this.events.on(SUBSCRIPTION_EVENTS.created, async (createdEvent: SubscriptionEvent.Created) => {
      const eventName = SUBSCRIPTION_EVENTS.created;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, data: createdEvent });
      await this.persist();
    });
    this.events.on(SUBSCRIPTION_EVENTS.deleted, async (deletedEvent: SubscriptionEvent.Deleted) => {
      const eventName = SUBSCRIPTION_EVENTS.deleted;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, data: deletedEvent });
      await this.persist();
    });
  }
}
