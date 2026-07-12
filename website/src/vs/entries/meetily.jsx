import { mount } from "../boot";
import { ComparisonPage } from "../ComparisonPage";
import { meetily } from "../competitors";

mount(<ComparisonPage data={meetily} />);
