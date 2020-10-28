import { Guid } from "guid-typescript";
/**
 * Class that represents an event to be handled by an BindableObserver.
 */
export declare abstract class Event {
    /**
     * Unique ID of the Event instance.
     */
    readonly id: Guid;
    constructor();
    /**
     * Unique name of the Event.
     *
     * This name is suppose to be globally unique to the Event type, because it
     * will be used to identify the Event type to the BindableObserver. It will
     * also be used to identify the Event type during serialization and
     * deserialization.
     *
     * It will be recommended to "namespace" the name in the following way:
     * `authorname-projectname-eventname`.
     *
     * Note: This function must never reference "this"
     */
    abstract get uniqueName(): string;
}
