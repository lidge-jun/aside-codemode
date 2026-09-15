# Synthetic search companion

Not the operator 55s/1s folder. Run:

```sh
node eval/bench-search.mjs --self-check
node eval/bench-search.mjs --repeats 3 --json
```

JSON always includes `notOperator51x: true`. A ratio is printed only when `equality` is true. Default `search.content` options are `fixedStrings: true`, `max: 1000`, `noIgnore: false`, `hidden: false`.
