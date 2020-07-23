import { Guid } from "guid-typescript";

export interface IEvent extends Object {
    readonly id: Guid;
    // TODO: Is name okay to be a symbol?
    name: string | symbol;
    data: any;
}
