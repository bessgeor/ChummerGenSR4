import { SetupError } from "../host/setup-error.js";

/** Two lanes that run as one user on one host; unlike a lane that could not be asked, this verdict is final. */
export class LaneConflict extends SetupError {}
