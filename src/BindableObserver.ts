import { EventEmitter } from "events";

import { Event } from "./Event";
import { EmitEvent } from "./EmitEvent";
import { UndefinedEmitterError } from "./UndefinedEmitterError";
import { NonUniqueNameRegisteredError } from "./NonUniqueNameRegisteredError";
import { EmitterChangedEvent } from "./EmitterChangedEvent";
import { ListenerBoundEvent } from "./ListenerBoundEvent";
import { ListenerRemovedEvent } from "./ListenerRemovedEvent";
import { CacheLimitChangedEvent } from "./CacheLimitChangedEvent";
import { ObserverBoundEvent } from "./ObserverBoundEvent";
import { ObserverUnboundEvent } from "./ObserverUnboundEvent";


// Re-export other classes
export { Event };
export { EmitEvent };
export { UndefinedEmitterError };
export { NonUniqueNameRegisteredError };
export { EmitterChangedEvent };
export { ListenerBoundEvent };
export { ListenerRemovedEvent };
export { CacheLimitChangedEvent };
export { ObserverBoundEvent };
export { ObserverUnboundEvent };


/**
 * Type representing the structure of a listener callback.
 */
export type ListenerType<T extends Event> = (x: Readonly<T>) => void;

/**
 * Valid types for passing to most BindableObserver functions that take an
 * event.
 * 
 * The only function that does not use this is BindableObserver.prototype.emit,
 * as it requires specifically an Event.
 * 
 * This type allows the user to, for example, call
 * ```ts
 *  myBindableObserver.on(MyEventType, () => {});
 * ```
 * or
 * ```ts
 * let eventInstance = new MyEventType();
 * myBindableObserver.on(eventInstance, () => {});
 * ```
 * and both behave identically.
 */
export type EventType<T extends Event> = T | (new (...args: any) => T);

/**
 * Structure for tracking when two BindableObservers are bound together
 * using BindableObserver.prototype.bind.
 * 
 * The bubble functions need to be stored so that they can be unbound later on
 * if the two BindableObservers are unbound from one another.
 * 
 * The reason both the "from" bubble function and "to" bubble functions are
 * tracked is given in the BindableObserver.prototype.bind documentation.
 */
type RelayEntry = {
	relay: BindableObserver,
	bubbleFunction: (event: Event) => void;
};


/**
 * Implementation of an Observer pattern bindable to other BindableObservers.
 * 
 * BindableObserver is not an EventEmitter, and cannot be used as an
 * EventEmitter. This is because anywhere where an EventEmitter would accept a
 * string or symbol as an event, the BindableObserver takes an Event object.
 * 
 * The BindableObserver takes Event objects because it needs to track each
 * event's id. This is so that when two or more BindableObservers are bound to
 * one another, an event is not infinitely emitted between the two.
 * 
 * Despite the fact that BindableObserver cannot be used as an EventEmitter, it
 * shares all the same function names with EventEmitter. This is to make the
 * functions intuitive for the user.
 * 
 * Underlying, BindableObserver uses a class derived from EventEmitter to emit
 * events. Specify which EventEmitter type is to be used using the generic
 * parameter.
 */
export class BindableObserver {
	/**
	 * Create the function that will be used to relay events from one
	 * BindableObserver to another.
	 * 
	 * @param observer The BindableObserver whose emit function will be called.
	 * @returns A function that is bindable to an event and that will call
	 * observer.emit, emitting an EventInvokedEvent provided as a parameter.
	 */
	private static generateBubbleFunction(observer: BindableObserver): (event: EmitEvent) => void {
		return (event: EmitEvent) => {
			observer.emit(event.emitted);
		};
	}


	/**
	 * Underlying EventEmitter used to handle event binding and emit.
	 */
	protected _emitter: EventEmitter | undefined;

	/**
	 * Map that relates each Event type with its own symbol internal to the
	 * BindableObserver. These symbols are what are bound to the emitter.
	 */
	protected _eventSymbolMap = new Map<new <T extends Event>(...args: any[]) => T, symbol>();

	/**
	 * Map that relates each symbol to the Event that was used to generate it.
	 * 
	 * This is used in removeAllListeners(). The event strings/symbols from the
	 * emitter are iterated through, and the constructors are got using this
	 * member.
	 */
	protected _inverseSymbolMap = new Map<symbol, new <T extends Event>(...args: any[]) => T>();

	/**
	 * Internal registry of unique names from Events, and the Events they were
	 * obtained from.
	 * 
	 * This is not used in BindableObserver, but can be used in children of
	 * BindableObserver. For example, it can be used to assist in serialization
	 * or deserialization of Events.
	 */
	protected _uniqueNameMap = new Map<string, new <T extends Event>(...args: any[]) => T>();

	/**
	 * Mapping of Events to user-defined symbols.
	 */
	protected _overrideEventSymbolMap = new Map<new <T extends Event>(...args: any[]) => T, symbol>();


	/**
	 * List of BindableObservers bound to this BindableObserver, as well as the
	 * functions registered to bind the two.
	 */
	private _relays: Array<RelayEntry>;

	/**
	 * Cache of previously-emitted event ids. If an event is emitted, and its id
	 * is found in here, the emit is canceled without anything happening.
	 */
	private _idCache: string[];

	/**
	 * Limit of how many entries can exist in the idCache array.
	 */
	private _cacheLimit: number;

	/**
	 * Should CacheLimitChangeEvents be emitted?
	 */
	private _emitCacheLimitChangeEvents: boolean;

	/**
	 * Should EmitterChangedEvents be emitted?
	 */
	private _emitEmitterChangedEvents: boolean;

	/**
	 * Should EmitEvents be emitted?
	 */
	private _emitEmitEvents: boolean;

	/**
	 * Should ListenerBoundEvents be emitted?
	 */
	private _emitListenerBoundEvents: boolean;

	/**
	 * Should ListenerRemovedEvents be emitted?
	 */
	private _emitListenerRemovedEvents: boolean;

	/**
	 * Should ObserverBoundEvents be emitted?
	 */
	private _emitObserverBoundEvents: boolean;

	/**
	 * Should ObserverUnboundEvents be emitted?
	 */
	private _emitObserverUnboundEvents: boolean;

	/**
	 * Symbol used for EmitEvents.
	 * 
	 * This member is used for when removeAllListeners() is called, so that the
	 * listeners used to bind BindableObservers are not removed as well.
	 */
	private _emitEventSymbol: symbol;

	/**
	 * When setEventSymbol() is called, and the Event's uniqueName has already
	 * been registered in this BindableObserver, should an error be thrown? If
	 * false, setEventSymbol() returns `false` instead of throwing an error.
	 */
	private _throwNonUniqueNameErrors: boolean = true;


	/**
	 * Construct a new BindableObserver using the given EventEmitter constructor
	 * or EventEmitter subclass instance.
	 * 
	 * The constructor will be used to create or set the underlying EventEmitter
	 * that will handle emitting events.
	 * 
	 * If no constructor or instance is given, a BindableObserver will still be
	 * constructed. However, any functions involving events will result in
	 * errors being thrown, until an emitter is provided using the
	 * setEmitter() function.
	 * 
	 * If constructing a BindableObserver with an instance of an EventEmitter,
	 * any preexisting bindings (or bindings made to the instance after
	 * constructing the BindableObserver) will not be altared. The EventEmitter
	 * instance will still behave normally.
	 * 
	 * When calling events via the EventEmitter, no events bound via the
	 * BindableObserver will be executed. Likewise, when calling events bound
	 * via the BindableObserver, no events bound to the EventEmitter will be
	 * executed.
	 * 
	 * Similarly, calling removeAllListeners() will only remove listeners bound
	 * with the BindableObserver. Any listeners bound with the emitter will not
	 * be affected in any way. However, calling removeAllListeners() on the
	 * emitter will still remove any listeners bound with the BindableObserver.
	 * 
	 * NOTE: While calling events from one does not interfere with the other,
	 * binding an Event class to a listener via BindableObserver will still
	 * invoke a 'newListener' event in the EventEmitter.
	 * 
	 * @param eventEmitter The type or instance of EventEmitter to use
	 * underlying the BindableObserver.
	 */
	public constructor(eventEmitter?: (new (...args: any[]) => EventEmitter) | EventEmitter, ...args: any[]) {
		this._relays = [];
		this._idCache = [];
		this._cacheLimit = 100;

		this._emitCacheLimitChangeEvents = true;
		this._emitEmitterChangedEvents = true;
		this._emitEmitEvents = true;
		this._emitListenerBoundEvents = true;
		this._emitListenerRemovedEvents = true;
		this._emitObserverBoundEvents = true;
		this._emitObserverUnboundEvents = true;

		this._emitEventSymbol = this.getOrCreateEventSymbol(EmitEvent) as symbol;

		if (eventEmitter) {
			this.setEmitter(eventEmitter, ...args);
		}
	}


	/**
	 * Whether this BindableObserver should emit `CacheLimitChangeEvent`s.
	 * 
	 * @returns if `CacheLimitChangeEvent`s are being emitted or not.
	 */
	public get emitCacheLimitChangeEvents(): boolean {
		return this._emitCacheLimitChangeEvents;
	}

	/**
	 * Whether this BindableObserver should emit `CacheLimitChangeEvent`s.
	 * 
	 * @param val if `CacheLimitChangeEvent`s should be emitted or not.
	 */
	public set emitCacheLimitChangeEvents(val: boolean) {
		this._emitCacheLimitChangeEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `EmitterChangedEvent`s.
	 * 
	 * @returns if `EmitterChangedEvent`s are being emitted or not.
	 */
	public get emitEmitterChangedEvents(): boolean {
		return this._emitEmitterChangedEvents;
	}

	/**
	 * Whether this BindableObserver should emit `EmitterChangedEvent`s.
	 * 
	 * @param val if `EmitterChangedEvent`s should be emitted or not.
	 */
	public set emitEmitterChangedEvents(val: boolean) {
		this._emitEmitterChangedEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `EmitEvent`s.
	 * 
	 * @returns if `EmitEvent`s are being emitted or not.
	 */
	public get emitEmitEvents(): boolean {
		return this._emitEmitEvents;
	}

	/**
	 * Whether this BindableObserver should emit `EmitEvent`s.
	 * 
	 * @param val if `EmitEvent`s should be emitted or not.
	 */
	public set emitEmitEvents(val: boolean) {
		this._emitEmitEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `ListenerBoundEvent`s.
	 * 
	 * @returns if `ListenerBoundEvent`s are being emitted or not.
	 */
	public get emitListenerBoundEvents(): boolean {
		return this._emitListenerBoundEvents;
	}

	/**
	 * Whether this BindableObserver should emit `ListenerBoundEvent`s.
	 * 
	 * @param val if `ListenerBoundEvent`s should be emitted or not.
	 */
	public set emitListenerBoundEvents(val: boolean) {
		this._emitListenerBoundEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `ListenerRemovedEvent`s.
	 * 
	 * @returns if `ListenerRemovedEvent`s are being emitted or not.
	 */
	public get emitListenerRemovedEvents(): boolean {
		return this._emitListenerRemovedEvents;
	}

	/**
	 * Whether this BindableObserver should emit `ListenerRemovedEvent`s.
	 * 
	 * @param val if `ListenerRemovedEvent`s should be emitted or not.
	 */
	public set emitListenerRemovedEvents(val: boolean) {
		this._emitListenerRemovedEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `ObserverBoundEvent`s.
	 * 
	 * @returns if `ObserverBoundEvent`s are being emitted or not.
	 */
	public get emitObserverBoundEvents(): boolean {
		return this._emitObserverBoundEvents;
	}

	/**
	 * Whether this BindableObserver should emit `ObserverBoundEvent`s.
	 * 
	 * @param val if `ObserverBoundEvent`s should be emitted or not.
	 */
	public set emitObserverBoundEvents(val: boolean) {
		this._emitObserverBoundEvents = val;
	}

	/**
	 * Whether this BindableObserver should emit `ObserverUnboundEvent`s.
	 * 
	 * @returns if `ObserverUnboundEvent`s are being emitted or not.
	 */
	public get emitObserverUnboundEvents(): boolean {
		return this._emitObserverUnboundEvents;
	}

	/**
	 * Whether this BindableObserver should emit `ObserverUnboundEvent`s.
	 * 
	 * @param val if `ObserverUnboundEvent`s should be emitted or not.
	 */
	public set emitObserverUnboundEvents(val: boolean) {
		this._emitObserverUnboundEvents = val;
	}

	/**
	 * When setEventSymbol() is called, and the Event's uniqueName has already
	 * been registered in this BindableObserver, should an error be thrown? If
	 * false, setEventSymbol() returns `false` instead of throwing an error.
	 * 
	 * @returns if an error should be thrown when registering an Event without a
	 * unique name.
	 */
	public get throwOnNonUniqueEventName(): boolean {
		return this._throwNonUniqueNameErrors;
	}

	/**
	 * When setEventSymbol() is called, and the Event's uniqueName has already
	 * been registered in this BindableObserver, should an error be thrown? If
	 * false, setEventSymbol() returns `false` instead of throwing an error.
	 * 
	 * @param val if an error should be thrown when registering an Event without
	 * a unique name.
	 */
	public set throwOnNonUniqueEventName(val: boolean) {
		this._throwNonUniqueNameErrors = val;
	}



	/**
	 * Get the limit of how many entries can exist in the id cache.
	 * 
	 * @returns The maximum number of ids that can exist in cache.
	 */
	public get cacheLimit(): number {
		return this._cacheLimit;
	}

	/**
	 * Set the limit of how many entries can exist in the id cache.
	 * 
	 * If the id cache is shrunk to less than the size of the current number of
	 * id entries, the oldest entries will be purged.
	 * 
	 * Setting the limit to <= 0 will remove the limit.
	 * 
	 * If the limit is successfully changed, a `CacheLimitChangedEvent` event
	 * will be emitted.
	 * 
	 * More info on how ids are stored can be found in
	 * BindableObserver.prototype.emit documentation.
	 * 
	 * @param limit The maximum number of ids to keep in cache. Setting to <= 0
	 * removes the limit.
	 * 
	 * @see BindableObserver.prototype.on for info about storing ids in cache.
	 */
	public set cacheLimit(limit: number) {
		if (limit <= 0) {
			limit = 0;
		}

		if (limit === this._cacheLimit) {
			return;
		}

		let oldLimit = this._cacheLimit;

		this._cacheLimit = limit;

		let idCacheOverflow = this._idCache.length - limit;
		this._idCache.splice(0, idCacheOverflow);

		if (this._emitCacheLimitChangeEvents && this._emitter) {
			this.emit(new CacheLimitChangedEvent(this, oldLimit, limit));
		}
	}

	/**
	 * Get the current number of ids in cache.
	 * 
	 * @returns The number of ids currently stored in cache.
	 */
	public get cacheSize(): number {
		return this._idCache.length;
	}

	/**
	 * Remove all ids from the id cache
	 */
	public clearCache(): void {
		this._idCache = [];
	};


	/**
	 * Get the current internal EventEmitter.
	 * 
	 * @returns The EventEmitter object used internally for handling events, or
	 * `undefined` if there is no currently set emitter.
	 */
	public getEmitter(): EventEmitter | undefined {
		return this._emitter;
	}

	/**
	 * Set or change the internal EventEmitter.
	 * 
	 * Emits an `EmitterChangedEvent` before the emitter is changed.
	 * 
	 * @see myBindableObserver.prototype.constructor for notes on how the
	 * eventEmitter parameter is used.
	 */
	public setEmitter(eventEmitter: (new (...args: any[]) => EventEmitter) | EventEmitter, ...args: any[]): void {
		let newEmitter: EventEmitter;

		if (typeof eventEmitter === "function") {
			newEmitter = new eventEmitter(...args);
		}
		else if (this._emitter === eventEmitter) {
			return;
		}
		else {
			newEmitter = eventEmitter;
		}

		if (this._emitEmitterChangedEvents && this._emitter) {
			this.emit(new EmitterChangedEvent(this, this._emitter, newEmitter));
		}

		this._emitter = newEmitter;
	}


	/**
	 * @alias BindableObserver.prototype.on
	 */
	public addListener<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		return this.on(event, listener);
	}

	/**
	 * Emit an event.
	 * 
	 * When an event is emitted, its id is first compared with the cache of
	 * stored ids. If its id is found in the cache, emit is terminated early,
	 * returning `false`.
	 * 
	 * If the event's id is not found in the cache, the id is stored in the
	 * cache and emit continues to call any listeners bound to the event.
	 * 
	 * When an event is emitted, a second event, an `EventInvokedEvent` is
	 * also emitted, with the original event as its data. This event's id is
	 * not stored in the id cache.
	 * 
	 * @param event Event to emit.
	 * @returns True if any listeners were called for the event, false
	 * otherwise.
	 */
	public emit(event: Event): boolean {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		// Check if the event has been processed already.
		if (this._idCache.includes(event.id)) {
			return false;
		}

		// Remove the oldest id if the cache limit is being exceeded
		if (this._cacheLimit > 0 && this._idCache.length === this._cacheLimit) {
			this._idCache.shift();
		}

		// Add the event id to the id cache
		this._idCache.push(event.id);

		let eventSymbol = this.getOrCreateEventSymbol(event);
		if (!eventSymbol) {
			return false;
		}

		let ret = this._emitter.emit(eventSymbol, event);

		if (this._emitEmitEvents) {
			let invokeEvent = new EmitEvent(event);
			this._emitter.emit(this.getOrCreateEventSymbol(invokeEvent) as symbol, invokeEvent);
		}

		return ret;
	}

	/**
	 * @alias BindableObserver.prototype.removeListener
	 */
	public off<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		return this.removeListener(event, listener);
	}

	/**
	 * Bind a listener to an event.
	 * 
	 * A listener is any function callback. Listeners will be called with a
	 * single parameter: the event instance that triggered them.
	 * 
	 * Emits a `ListenerBoundEvent` after binding the new listener.
	 * 
	 * @param event The type of Event to bind to. This can either be an Event
	 * class or an instance of an Event. Note: Binding to an instance of an
	 * event will still allow the listener to be called when ANY instance of
	 * that same event is emitted.
	 * @param listener Callback to execute when the Event type is emitted.
	 * @returns Reference to self.
	 */
	public on<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getOrCreateEventSymbol(event);
		if (!eventName) {
			return this;
		}

		this._emitter.on(eventName, listener);

		if (this._emitListenerBoundEvents) {
			this.emit(new ListenerBoundEvent(this, listener, (typeof event === "function" ? event : event.constructor as new (...args: any[]) => T), false));
		}

		return this;
	}

	/**
	 * Same as BindableObserver.prototype.on, but the listener is immediately
	 * unbound once it is called.
	 * 
	 * Emits a `ListenerBoundEvent` after binding the new listener.
	 * 
	 * @param event The type of Event to bind to. This can either be an Event
	 * class or an instance of an Event. Note: Binding to an instance of an
	 * event will still allow the listener to be called when ANY instance of
	 * that same event is emitted.
	 * @param listener Callback to execute when the Event type is emitted.
	 * @returns Reference to self.
	 */
	public once<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getOrCreateEventSymbol(event);
		if (!eventName) {
			return this;
		}

		this._emitter.once(eventName, listener);

		if (this._emitListenerBoundEvents) {
			this.emit(new ListenerBoundEvent(this, listener, (typeof event === "function" ? event : event.constructor as new (...args: any[]) => T), true));
		}

		return this;
	}

	/**
	 * Same as BindableObserver.prototype.on, but the listener is prepended to
	 * the list of bound listeners. When the event is emitted, this listener
	 * will have priority in execution order.
	 * 
	 * Emits a `ListenerBoundEvent` after binding the new listener.
	 * 
	 * @param event The type of Event to bind to. This can either be an Event
	 * class or an instance of an Event. Note: Binding to an instance of an
	 * event will still allow the listener to be called when ANY instance of
	 * that same event is emitted.
	 * @param listener Callback to execute when the Event type is emitted.
	 * @returns Reference to self.
	 */
	public prependListener<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getOrCreateEventSymbol(event);
		if (!eventName) {
			return this;
		}

		this._emitter.prependListener(eventName, listener);

		if (this._emitListenerBoundEvents) {
			this.emit(new ListenerBoundEvent(this, listener, (typeof event === "function" ? event : event.constructor as new (...args: any[]) => T), false));
		}

		return this;
	}

	/**
	 * Same as BindableObserver.prototype.once, but the listener is prepended to
	 * the list of bound listeners. When the event is emitted, this listener
	 * will have priority in execution order.
	 * 
	 * Emits a `ListenerBoundEvent` after binding the new listener.
	 * 
	 * @param event The type of Event to bind to. This can either be an Event
	 * class or an instance of an Event. Note: Binding to an instance of an
	 * event will still allow the listener to be called when ANY instance of
	 * that same event is emitted.
	 * @param listener Callback to execute when the Event type is emitted.
	 * @returns Reference to self.
	 */
	public prependOnceListener<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getOrCreateEventSymbol(event);
		if (!eventName) {
			return this;
		}

		this._emitter.prependOnceListener(eventName, listener);

		if (this._emitListenerBoundEvents) {
			this.emit(new ListenerBoundEvent(this, listener, (typeof event === "function" ? event : event.constructor as new (...args: any[]) => T), true));
		}

		return this;
	}

	/**
	 * Remove all listeners bound to a type of event. If event is omitted, all
	 * listeners are removed from every event type.
	 * 
	 * A `ListenerRemovedEvent` is emitted for each listener that was removed.
	 * 
	 * NOTE: If the event is omitted, any listeners bound using the emitter will
	 * not be affected. This only removes listeners bound to `Event`s.
	 * 
	 * @param event The type of event to unbind from. This can either be an
	 * Event class or an instance of an Event. If this parameter is omitted, all
	 * listeners will be removed from every event.
	 * @returns Reference to self.
	 */
	public removeAllListeners<T extends Event>(event?: EventType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		if (event) {
			let eventName = this.getEventSymbol(event);
			if (!eventName) {
				return this;
			}

			let listeners: ((event: Event) => void)[] = [];

			// if eventName is the symbol for EmitEvent
			if (eventName === this._emitEventSymbol) {
				// Get all the EmitEvent listeners
				listeners = this._emitter.listeners(eventName) as ((event: Event) => void)[];

				// filter out the listeners used for binding observers
				for (let relay of this._relays) {
					listeners.splice(listeners.indexOf(relay.bubbleFunction), 1);
				}
				// individually remove each remaining listener
				for (let listener of listeners) {
					this._emitter.removeListener(eventName, listener);
				}
			}
			else {
				if (this._emitListenerRemovedEvents) {
					listeners = this._emitter.listeners(eventName) as ((event: Event) => void)[];
				}
				this._emitter.removeAllListeners(eventName);
			}

			if (this._emitListenerRemovedEvents) {
				for (const listener of listeners) {
					this.emit(new ListenerRemovedEvent(this, listener, typeof event === "function" ? event : event.constructor as new (...args: any[]) => T));
				}
			}
		}
		else {
			for (const event of this._emitter.eventNames()) {
				let eventType: (new (...args: any[]) => T) | undefined;
				if (typeof event === "symbol" && (eventType = this._inverseSymbolMap.get(event))) {
					this.removeAllListeners(eventType);
				}
			}
		}

		return this;
	}

	/**
	 * Unbind a listener from an event.
	 * 
	 * Emits a `ListenerRemovedEvent` if a listener was successfully removed.
	 * 
	 * @param event Event the listener is bound to. This can either be an Event
	 * class or an instance of an Event.
	 * @param listener Listener to unbind.
	 * @returns Reference to self.
	 */
	public removeListener<T extends Event>(event: EventType<T>, listener: ListenerType<T>): this {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getEventSymbol(event);
		if (!eventName) {
			return this;
		}

		if (this.hasListener(event, listener)) {
			this._emitter.removeListener(eventName, listener);

			if (this._emitListenerRemovedEvents) {
				this.emit(new ListenerRemovedEvent(this, listener, typeof event === "function" ? event : event.constructor as new (...args: any[]) => T));
			}
		}

		return this;
	}

	/**
	 * Check if a listener is bound to a specific event.
	 * 
	 * @param event Event the listener would be bound to. This can either be an
	 * Event class or an instance of an Event.
	 * @param listener Listener to check for.
	 * @returns True if the listener is bound to the event, false otherwise.
	 */
	public hasListener<T extends Event>(event: EventType<T>, listener: ListenerType<T>): boolean {
		if (this._emitter === undefined) {
			throw new UndefinedEmitterError();
		}

		let eventName = this.getEventSymbol(event);
		if (!eventName) {
			return false;
		}

		return this._emitter.listeners(eventName).includes(listener);
	}


	/**
	 * Bind a BindableObserver to this BindableObserver.
	 * 
	 * Bound observers emit their events on the relay observer supplied.
	 * 
	 * @param relay BindableObserver to bind to this observer.
	 */
	public bind(relay: BindableObserver): void {
		if (this._relays.find(element => element.relay === relay)) {
			return;
		}

		let bubble = BindableObserver.generateBubbleFunction(relay);

		let entry = {
			relay: relay,
			bubbleFunction: bubble,
		};
		this._relays.push(entry);

		// Binding to a relay means to bind this.emit to an EventInvokedEvent on relay.
		this.on(EmitEvent, bubble);

		if (this._emitObserverBoundEvents && this._emitter) {
			this.emit(new ObserverBoundEvent(this, relay));
		}
	}

	/**
	 * Check if a BindableObserver is bound to this observer.
	 * 
	 * @param relay BindableObserver to check.
	 * @returns True if the observer is bound to this observer, false otherwise.
	 */
	public checkBinding(relay: BindableObserver): boolean {
		return this._relays.find(e => e.relay === relay) !== undefined;
	}

	/**
	 * Unbind a BindableObserver from this BindableObserver.
	 * 
	 * If the provided observer is not bound to this observer, this is a no-op
	 * function.
	 * 
	 * @param relay BindableObserver to unbind from this.
	 */
	public unbind(relay: BindableObserver): void {
		let foundIndex = this._relays.findIndex(element => element.relay === relay);
		if (foundIndex === -1) {
			return;
		}

		let found = this._relays[foundIndex];
		this._relays.splice(foundIndex, 1);

		this.removeListener(EmitEvent, found.bubbleFunction);

		if (this._emitObserverUnboundEvents && this._emitter) {
			this.emit(new ObserverUnboundEvent(this, relay));
		}
	}


	/**
	 * Gets the symbol corresponding to the given event.
	 * 
	 * This symbol is used for binding or calling
	 * `BindableObserver.prototype.emitter`.
	 * 
	 * If the Event does not have a symbol already registered, a new symbol is
	 * created using `BindableObserver.prototype.registerEvent(event)`.
	 * 
	 * @param event Event type or instance to get a symbol for.
	 * @returns A symbol representing the type of event given, or `undefined` if
	 * `BindableObserver.prototype.registerEvent` was called and returned false.
	 */
	public getOrCreateEventSymbol<E extends Event>(event: EventType<E>): symbol | undefined {
		let constructor: new <X extends Event>(...args: any[]) => X;
		if (typeof event === "function") {
			constructor = event as new <X extends Event>(...args: any[]) => X;
		}
		else {
			constructor = event.constructor as new <X extends Event>(...args: any[]) => X;
		}

		let overrideSymbol = this._overrideEventSymbolMap.get(constructor);
		if (overrideSymbol) {
			return overrideSymbol;
		}

		let sym = this._eventSymbolMap.get(constructor);
		if (!sym) {
			if (!this.registerEvent(event)) {
				return undefined;
			}

			sym = this._eventSymbolMap.get(constructor);
		}

		return sym;
	}

	/**
	 * Get the symbol associated with an Event.
	 * 
	 * @param event Event whose associated symbol is to be retrieved.
	 * @returns symbol associated with the `event`, or `undefined` if no symbol was found (i.e. the `Event` type wasn't registered)
	 */
	public getEventSymbol<E extends Event>(event: EventType<E>): symbol | undefined {
		let constructor: new <X extends Event>(...args: any[]) => X;
		if (typeof event === "function") {
			constructor = event as new <X extends Event>(...args: any[]) => X;
		}
		else {
			constructor = event.constructor as new <X extends Event>(...args: any[]) => X;
		}

		let overrideSymbol = this._overrideEventSymbolMap.get(constructor);
		if (overrideSymbol) {
			return overrideSymbol;
		}

		return this._eventSymbolMap.get(constructor);
	}

	/**
	 * Register an Event with the BindableObserver.
	 * 
	 * This symbol is used for binding or calling the
	 * BindableObserver.prototype.emitter.
	 * 
	 * If the Event does not have a symbol already registered, a new symbol is
	 * created using the Event's uniqueName property. If this uniqueName was
	 * already used to create a symbol (i.e. it was found on a different Event
	 * as well), one of two behaviors occur.
	 * 1. If `BindableObserver.prototype.throwOnNonUniqueEventName` is set, a
	 * `NonUniqueNameRegisteredError` is thrown.
	 * 2. If `BindableObserver.prototype.throwOnNonUniqueEventName` is not set,
	 * the function returns `false`.
	 * 
	 * Events can be registered with a different `forceUniqueSymbol` setting
	 * after being set once, without needing to remove them first.
	 * 
	 * @param event Event type to create a symbol for.
	 * @param forceUniqueSymbol allow this event to be registered without caring
	 * about its uniqueName attribute. This is to assist when two different
	 * Event types are registered with identical uniqueNames. Defaults to
	 * `false`.Note: Internally, if forceUniqueSymbol is set, the Event
	 * information is not populated into
	 * `BindableObserver.prototype.eventSymbolMap`,
	 * `BindableObserver.prototype.inverseSymbolMap`, or
	 * `BindableObserver.prototype.uniqueNameMap`.
	 * @returns `true` if the Event was successfully registered, `false`
	 * otherwise if `BindableObserver.prototype.throwOnNonUniqueEventName` isn't
	 * set.
	 * @throws `NonUniqueNameRegisteredError` if the registered Event's
	 * uniqueName was used on another registered Event, and
	 * `BindableObserver.prototype.throwOnNonUniqueEventName` is set.
	 */
	public registerEvent<E extends Event>(event: EventType<E>, forceUniqueSymbol: boolean = false): boolean {
		let constructor: new <T extends Event>(...args: any[]) => T;
		let name: string;

		// Get the constructor function for the event
		if (typeof event === "function") {
			constructor = event as new <T extends Event>(...args: any[]) => T;
			name = (new event()).uniqueName;
		}
		else {
			constructor = event.constructor as new <T extends Event>(...args: any[]) => T;
			name = event.uniqueName;
		}

		// Check if a symbol has already been made for the constructor
		let hasSymbol = this._eventSymbolMap.has(constructor);
		let hasOverrideSymbol = this._overrideEventSymbolMap.has(constructor);

		// If there already exists a symbol for the constructor, early return true.
		if (forceUniqueSymbol) {
			if (hasOverrideSymbol) {
				return true;
			}
		}
		else if (hasSymbol) {
			return true;
		}

		if (forceUniqueSymbol) {
			// If the symbol exists, but is switching between unique <-> nonUnique
			if (hasSymbol) {
				let oldSym = this._eventSymbolMap.get(constructor) as symbol;
				this._eventSymbolMap.delete(constructor);
				this._uniqueNameMap.delete(name);

				this._overrideEventSymbolMap.set(constructor, oldSym);
			}
			else {
				let sym = Symbol(name);
				this._overrideEventSymbolMap.set(constructor, sym);
				this._inverseSymbolMap.set(sym, constructor);
			}
		}
		else {
			if (this._uniqueNameMap.has(name)) {
				if (this.throwOnNonUniqueEventName) {
					throw new NonUniqueNameRegisteredError(name, this._uniqueNameMap.get(name) as new <T extends Event>(...args: any[]) => T, constructor);
				}
				else {
					return false;
				}
			}
			if (hasOverrideSymbol) {
				let oldSym = this._overrideEventSymbolMap.get(constructor) as symbol;
				this._overrideEventSymbolMap.delete(constructor);

				this._eventSymbolMap.set(constructor, oldSym);
				this._uniqueNameMap.set(name, constructor);
			}
			else {
				let symbol = Symbol(name);
				this._eventSymbolMap.set(constructor, symbol);
				this._inverseSymbolMap.set(symbol, constructor);
				this._uniqueNameMap.set(name, constructor);
			}
		}

		return true;
	}

	/**
	 * Unregister an Event from the BindableObserver.
	 * 
	 * Note: This function does not remove any listeners that might be bound to
	 * this Event.
	 * 
	 * @param event Event to unregister from the BindableObserver.
	 * @returns `true` if the Event was successfully unregistered, `false`
	 * otherwise.
	 */
	public unregisterEvent<E extends Event>(event: EventType<E>): boolean {
		let constructor: new <T extends Event>(...args: any[]) => T;
		let name: string;
		if (typeof event === "function") {
			constructor = event as new <T extends Event>(...args: any[]) => T;
			name = (new event()).uniqueName;
		}
		else {
			constructor = event.constructor as new <T extends Event>(...args: any[]) => T;
			name = event.uniqueName;
		}

		if (this._overrideEventSymbolMap.delete(constructor)) {
			return true;
		}

		if (!this._eventSymbolMap.has(constructor)) {
			return false;
		}

		let oldSym = this._eventSymbolMap.get(constructor) as symbol;
		this._eventSymbolMap.delete(constructor);
		this._inverseSymbolMap.delete(oldSym);
		this._uniqueNameMap.delete(name);

		return true;
	}
}
