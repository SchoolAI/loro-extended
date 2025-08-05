# The Elm Architecture

Now let's re-imagine the `Repo` class as a TEA-style state machine, using [`raj`](https://github.com/hyperapp/raj). Raj is a neat, lightweight library that brings the core concepts of The Elm Architecture—a centralized immutable state, messages that trigger transitions, and a pure `update` function—to JavaScript. It's an excellent model for managing complex component state predictably.

Let's analyze @/packages/repo/src/repo.ts  to see what it currently does. Note that its paradigm may be mixed: some message handling, some emit, some direct calls. Let's think clearly about how this part of the overall Repo should work (notes at @/packages/repo/src/repo.md may be relevant).

In particular, the raj-ts library has some specific types that can help us create a new, more functional style program:

```
export type Dispatch<Msg> = {
  (value: Msg): void
}

export type Effect<Msg> = {
  (dispatch: Dispatch<Msg>): void
}

export type Change<Msg, Model> = [Model] | [Model, Effect<Msg> | undefined]

export type Program<Msg, Model, View> = {
  init: [Model] | [Model, Effect<Msg> | undefined]
  update(msg: Msg, model: Model): [Model] | [Model, Effect<Msg> | undefined]
  view(model: Model, dispatch: Dispatch<Msg>): View
  done?(model: Model): void
}

export type Disposer = {
  (): void
}

export function runtime<Msg, Model, View>(
  program: Program<Msg, Model, View>
): Disposer {
  const { init, update, view, done } = program
  let state: Model
  let isRunning = true

  function dispatch(message: Msg) {
    if (isRunning) {
      change(update(message, state))
    }
  }

  function change(change: Change<Msg, Model>) {
    state = change[0]
    const effect = change[1]
    if (effect) {
      effect(dispatch)
    }
    view(state, dispatch)
  }

  change(init)

  return function end() {
    if (isRunning) {
      isRunning = false
      if (done) {
        done(state)
      }
    }
  }
}
```

Here is what the raj Documentation offers:

<raj-docs>
# Raj by Example

> [Raj](https://github.com/andrejewski/raj) is the best JavaScript framework.

This is the complement to [Why Raj](https://jew.ski/why-raj/), which offers a much more high level explanation for why you should use Raj. Here, we show code samples written with Raj.

Written for reading in order, we gradually build up Raj programs with libraries from the [Raj ecosystem](https://github.com/andrejewski/raj#ecosystem).

## Contents

1. [The Atom](#1-the-atom): Basic program structure
1. [Mixed Signals](#2-mixed-signals): Explaining messages
1. [Real Work](#3-real-work): Performing side-effects
1. [Big Picture](#4-big-picture): Program composition
1. [Prove It](#5-prove-it): Testing programs
1. [Elm Street](#6-elm-street): Comparing with Elm

## 1. The Atom
In Raj, the atomic unit is a program. Every Raj application is a program no matter the complexity. The program consists of three parts: `init`, `update`, and `view`. The smallest valid program is:

```js
export default {
  init: [],
  update: () => [],
  view () {}
}
```

This program does nothing but highlight the required parts. Note:

- `init` must be an array
- `update` must be a function and must return an array
- `view` must be a function

Now we will make the smallest "useful" program, a counter.

```js
export default {
  init: [0], // State is an integer to count
  update (message, state) {
    return [state + 1] // Increment the state
  },
  view (state, dispatch) {
    const keepCounting = window.confirm(`Count is ${state}. Increment?`)
    if (keepCounting) {
      dispatch()
    }
  }
}
```

This program is simple but highlights more than the previous program. Note:

- `init` must be an array whose first index `init[0]` is the initial state of the program. In the previous example, the `init` of `[]` meant the initial state equals undefined. This is valid because there are no restrictions on what state can be. In this new example, `0` is the initial state.

- `update` receives two arguments `message` and `state`. We do not know the purpose of `message` yet, but `state` must be the current state. We also see we return an array with the first index being the new state.

- `view` receives two arguments `state`, which again is the current state, and `dispatch` which is some function we can call. We can have a useful program without have view return anything.

At this point, we have not introduced Raj. These programs defined above are plain objects and certainly cannot call themselves. To get these programs to *run* we need some sort of *run*-time. Raj is a runtime.

```js
import { runtime } from 'raj'

runtime({
  init: [0], // State is an integer to count
  update (message, state) {
    return [state + 1] // Increment the state
  },
  view (state, dispatch) {
    const keepCounting = window.confirm(`Count is ${state}. Increment?`)
    if (keepCounting) {
      dispatch()
    }
  }
})
```

Now we have a working program. For now we can think about the runtime as having one job: store the current program state. The Raj runtime needs to work like this:

```js
export function program ({init, update, view}) {
  let state = init[0]
  const render = () => {
    const message = undefined // still don't know what this is
    state = update(message, state)[0]
    view(state, render)
  }
  view(state, render)
}
```

This is missing some features but the Raj runtime creates this run loop under the hood.

## 2. Mixed Signals

At this point, we have at least two questions:

- What is `message`!?
- When does this start being useful?

To answer these questions, we need more realistic examples. Raj is view layer agnostic meaning (as we have seen) `view` receives the newest state and a `dispatch` function and then can do anything. View layer integrations take advantage of this open-ended contract.

One such integration from the Raj ecosystem [`raj-react`](https://github.com/andrejewski/raj-react) allows us to write Raj programs which become React components. We will use React in the following examples but keep in mind we could be using a different view library. It makes no difference to Raj.

Let's update the counter example to use `raj-react`.

```js
import React from 'react'
import ReactDOM from 'react-dom'
import {program} from 'raj-react'

const Program = program(React.Component, () => ({
  init: [0], // State is an integer to count
  update (message, state) {
    return [state + 1] // Increment the state
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch()}>Increment</button>
    </div>
  }
}))

ReactDOM.render(<Program />, document.getElementById('app'))
```

Note the `init` and `update` remain the same. Since we are separating concerns well, it makes sense we change the `view` alone. The `raj-react` `program()` returns a React component we mount inside of our webpage.

Now we can start building more complex programs. We have been able to increment, now we'll decrement too.

```js
import React from 'react'
import ReactDOM from 'react-dom'
import {program} from 'raj-react'

const Program = program(React.Component, () => ({
  init: [0], // State is an integer to count
  update (message, state) {
    return [state + message] // Add to the state
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch(1)}>Increment</button>
      <button onClick={() => dispatch(-1)}>Decrement</button>
    </div>
  }
}))

ReactDOM.render(<Program />, document.getElementById('app'))
```

We see that `message` is the first argument passed to `dispatch`. In this case the message is `+1` or `-1` which gets added to the state every time we click a button.

Now let's go crazy and add a reset button that will take the state back to zero when we click it. We *could* do `dispatch(-state)` to do this, but I'd rather keep the view stupid and behavior driven. Let's define the behaviors `increment`, `decrement`, and `reset` and dispatch those.

```js
export default {
  init: [0], // State is an integer to count
  update (message, state) {
    switch (message) {
      case 'increment': return [state + 1]
      case 'decrement': return [state - 1]
      case 'reset': return [0]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch('increment')}>Increment</button>
      <button onClick={() => dispatch('decrement')}>Decrement</button>
      <button onClick={() => dispatch('reset')}>Reset</button>
    </div>
  }
}
```

This is a better contract because now we can change the business logic in `update` without needing to change the `view`. For example, if we decided as requirements change to increment and decrement by 2 the place to make this change is clear.

We can get even crazier, but the key take ways are:

- The `message` is the first argument to `dispatch`.
- Messages can be anything, but best practice is to write them as behaviors and leave the business logic to the `update` function.

This is how programs build up in Raj. Complex programs use libraries to help build their messages. The recommended library for this is [`tagmeme`](https://github.com/andrejewski/tagmeme).

## 3. Real Work
We are continuing to unravel the program pattern, but there is still a lurking question: why do we have to wrap `init` and new states from `update` in an array? The answer is: side effects.

Until now all we have been doing is updating our own state. Side effects let us start interacting with the outside world. While our `init`, `update`, and `view` functions are synchronous and deterministic, effects will allow us to incorporate asynchronous and non-deterministic behavior into our programs, sanely.

The smallest effect you can have is `() => {}`, a no-op. An effect does not have to do anything. Let's make a somewhat useful one:

```js
export default function effect (dispatch) {
  setTimeout(() => dispatch('beep'), 1000)
}
```

Raj calls all effects with the `dispatch` function. This effect waits one second and then dispatches a "beep" message. The provided `dispatch` function is the same one passed to `view`. The dispatched beep message goes into the runtime in the same way, calling the `update` and creating a new state.

The reason we need to wrap every state in an array is because the second index of that array is for an optional effect. Let's put this effect to use in our counter.

```js
export function effect (dispatch) {
  setTimeout(() => dispatch('beep'), 1000)
}

export default {
  init: [0, effect],
  update (message, state) {
    switch (message) {
      case 'increment': return [state + 1]
      case 'decrement': return [state - 1]
      case 'reset': return [0]
      case 'beep': return [-state, effect]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch('increment')}>Increment</button>
      <button onClick={() => dispatch('decrement')}>Decrement</button>
      <button onClick={() => dispatch('reset')}>Reset</button>
    </div>
  }
}
```

Now our counter is idiotic. Every second the counter will switch signs. We can still click the buttons like normal. Note:

- The `init` has an optional effect. When the runtime starts, Raj calls that function with `dispatch`.
- The `update` can return an optional effect. Raj calls it the same way as the `init` effect.
- Since `init` will trigger a "beep" and the "beep" case will trigger a "beep" we have built for ourselves an effect cycle. Do not do this in applications, this is to practice effects.

Instead of an effect loop like above we can write effects which dispatch messages. These require no new syntax because any effect can call `dispatch` any number of times. An effect that dispatches beep every second looks like this:

```js
export default function beepEverySecond (dispatch) {
  setInterval(() => dispatch('beep'), 1000)
}
```

We can use AJAX/`fetch` to make network requests in effects too.
Raj does not care.

### 3.1. Real Life

With effects as open-ended as they are we do need to be aware of the pitfall: death. The above `beepEverySecond` effect will run forever. This may be what you want in a simple program but probably not in a large application. For these effects that we want to stop sometime later, we need to think in *cancellable* subscriptions.

A subscription has no required syntax, but the recommended approach to building subscriptions is like:

```js
export default function subscription () {
  // internal state for the subscription
  return {
    effect (dispatch) {
      // this effect starts the subscription
      // setup a recurring dispatch
    },
    cancel () {
      // this effect ends the subscription
      // teardown the recurring dispatch (if it exists)
      // NOTE: we don't use dispatch here
    }
  }
}
```

Let's rewrite our `beepEverySecond` as a subscription to see something more than a scaffold.

```js
export default function beepEverySecond () {
  let intervalId
  return {
    effect (dispatch) {
      intervalId = setInterval(() => {
        dispatch('beep')
      }, 1000)
    },
    cancel () {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }
}
```

Now we can cancel the beeping sometime later in the program. Refactoring the counter example, we now have:

```js
export function beepEverySecond () {
  let intervalId
  return {
    effect (dispatch) {
      intervalId = setInterval(() => {
        dispatch('beep')
      }, 1000)
    },
    cancel () {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }
}

const {effect, cancel} = beepEverySecond()
export default {
  init: [0, effect], // start beeping
  update (message, state) {
    switch (message) {
      case 'increment': return [state + 1]
      case 'decrement': return [state - 1]
      case 'reset': return [0]
      case 'beep': return [-state, cancel] // end beeping
    }
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch('increment')}>Increment</button>
      <button onClick={() => dispatch('decrement')}>Decrement</button>
      <button onClick={() => dispatch('reset')}>Reset</button>
    </div>
  }
}
```

When the program runs, the subscription `effect` gets called, the "beep" message hits `update` and the `cancel` gets called. The result is that the "beep" message happens once.

### 3.2. Die Hard
Since we are on the topic of death, let us talk about the death of runtimes.
Like effects that we want to stop, we also want to stop a Raj runtime in some cases.
For example, in `raj-react` when our `<Program />` leaves the page we should stop the runtime.
Doing so makes us memory safe and garbage collectable.

The `raj-react` component ends the runtime itself, but if you were looking to end a normal Raj runtime, you would do:

```js
import { runtime } from 'raj'

const endRuntime = runtime({
  init: [],
  update: () => [],
  view () {}
})

endRuntime() // the runtime has stopped
```

We have a problem here. What if the program had an active subscription and the runtime died? The subscription would run forever and never cancel. To handle this, we have to introduce the purposefully neglected up to this point optional program method `done`.

```js
export default {
  init: [],
  update: () => [],
  view () {},
  done () {} // optional
}
```

The `done` method receives the final state of program when the runtime dies, giving us our last chance to stop all active subscriptions.

We can make the counter example fully safe by leveraging this new `done` method.

```js
export function beepEverySecond () {
  let intervalId
  return {
    effect (dispatch) {
      intervalId = setInterval(() => {
        dispatch('beep')
      }, 1000)
    },
    cancel () {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }
}

const {effect, cancel} = beepEverySecond()
export default {
  init: [0, effect], // start beeping
  update (message, state) {
    switch (message) {
      case 'increment': return [state + 1]
      case 'decrement': return [state - 1]
      case 'reset': return [0]
      case 'beep': return [-state, cancel] // end beeping
    }
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch('increment')}>Increment</button>
      <button onClick={() => dispatch('decrement')}>Decrement</button>
      <button onClick={() => dispatch('reset')}>Reset</button>
    </div>
  },
  done (state) {
    // we don't need state in this example
    // but we often store cancel effects in the state
    cancel()
  }
}
```

Now we know everything there is to know about the Raj runtime.

## 4. Big Picture

We spent a lot of time understanding the runtime, which is crucial. Every Raj program will follow this same structure so we need this foundation. We understand the runtime and the next step is to build real applications.

Per application, there is one runtime. This runtime represents the "root" top-most construct. In fact, most Raj application need Raj for no more than one line of boilerplate. The rest, following this program pattern, is your own application which you have creative liberty to build. This flexibility and strict pattern make Raj applications fun to write, design, and compose together while creating good programs.

Program composition has concerns:

- Nesting programs
- Shared state
- Parent to child communication
- Child to parent communication

Using our counter to exemplify these concerns:

- We have a program to which we want to add our counter.
- We have two counters and we want them to manipulate the same number.
- We have an initial value other than `0` we want a counter to start from.
- We want to let the parent program know when the counter is high `> 100`.

The simple increment counter we made in React is good enough to show the concepts. For reference:

```js
// counter.js
export default {
  init: [0], // State is an integer to count
  update (message, state) {
    return [state + 1] // Increment the state
  },
  view (state, dispatch) {
    return <div>
      <p>Count is {state}.</p>
      <button onClick={() => dispatch()}>Increment</button>
    </div>
  }
}
```

### 4.1. Nesting programs
We have a program which contains a counter program.

```js
import counter from './counter'

const [counterState, counterEffect] = counter.init
let effect
if (counterEffect) {
  effect = dispatch => {
    counterEffect(message => {
      dispatch({
        type: 'counterMessage',
        data: message
      })
    })
  }
}
const init = [{
  counterState
}, effect]

export default {
  init,
  update (message, state) {
    if (message.type === 'counterMessage') {
      const [
        newCounterState,
        counterEffect
      ] = counter.update(message.data, state.counterState)
      const newState = {...state, counterState: newCounterState}
      let effect
      if (counterEffect) {
        effect = dispatch => {
          counterEffect(message => {
            dispatch({
              type: 'counterMessage',
              data: message
            })
          })
        }
      }
      return [newState, effect]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>This is the root program.</p>
      {counter.view(state.counterState, message => {
        dispatch({
          type: 'counterMessage',
          data: message
        })
      })}
    </div>
  }
}
```

Note:

- The parent program's `init` contains the `init` of the counter.
- The parent program wraps the `init` effect's messages in `{type: 'counterMessage', data}` by intercepting the messages from the counter effect and then re-dispatching them as part of the parent's messages.
- The parent program `update` calls the `update` of the counter with its state and that message we wrap.
- The parent program wraps the `init` effect's messages in `{type: 'counterMessage', data}` by intercepting the messages from the counter effect and then re-dispatching them as part of the parent's messages.
- The parent program `view` calls the `view` of the counter with its state and wraps dispatched messages.

We know counter does not yet have effects, but more useful programs will so we need to know how to handle them.

This is a lot of boilerplate to compose programs. We can leverage the Raj ecosystem library [`raj-compose`](https://github.com/andrejewski/raj-compose) to clean up this plumbing. The most helpful utility in this case is `mapEffect` which does the following:

```js
export function mapEffect (effect, callback) {
  if (!effect) {
    return effect
  }
  return function _mapEffect (dispatch) {
    function intercept (message) {
      dispatch(callback(message))
    }

    return effect(intercept)
  }
}
```

We rewrite the previous example as follows, also pulling out that "counterMessage" wrapper:

```js
import {mapEffect} from 'raj-compose'
import counter from './counter'

const counterMessage = message => ({
  type: 'counterMessage',
  data: message
})

const [counterState, counterEffect] = counter.init
const init = [
  {counterState},
  mapEffect(counterEffect, counterMessage)
]

export default {
  init,
  update (message, state) {
    if (message.type === 'counterMessage') {
      const [
        newCounterState,
        counterEffect
      ] = counter.update(message.data, state.counterState)
      const newState = {...state, counterState: newCounterState}
      return [newState, mapEffect(counterEffect, counterMessage)]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>This is the root program.</p>
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
    </div>
  }
}
```

We *could* reduce the boilerplate further by leveraging `raj-compose/mapProgram` or something even more prescriptive. Be wary of optimizing for boilerplate: if we write code that is too concise we sacrifice readability and understanding of our programs.

### 4.2. Shared state
We have two counters and we want them to manipulate the same number.

```js
import {mapEffect} from 'raj-compose'
import counter from './counter'

const counterMessage = message => ({
  type: 'counterMessage',
  data: message
})

const [counterState, counterEffect] = counter.init
const init = [
  {counterState},
  mapEffect(counterEffect, counterMessage)
]

export default {
  init,
  update (message, state) {
    if (message.type === 'counterMessage') {
      const [
        newCounterState,
        counterEffect
      ] = counter.update(message.data, state.counterState)
      const newState = {...state, counterState: newCounterState}
      return [newState, mapEffect(counterEffect, counterMessage)]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>This is the root program.</p>
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
    </div>
  }
}
```

In this case shared state is easy: we are changing the view to render two counters that receive the same state. Shared state needs to be at least as high up the program chain to contain the relevant sub-programs.

### 4.3. Parent to child communication
We have an initial value other than `0` we want a counter to start from.

```js
// back in counter.js
export function initWithCount (initialCount) {
  return [initWithCount]
}
```

```js
import {mapEffect} from 'raj-compose'
import counter, {initWithCount} from './counter'

const counterMessage = message => ({
  type: 'counterMessage',
  data: message
})

const [counterState, counterEffect] = initWithCount(42)
const init = [
  {counterState},
  mapEffect(counterEffect, counterMessage)
]

export default {
  init,
  update (message, state) {
    if (message.type === 'counterMessage') {
      const [
        newCounterState,
        counterEffect
      ] = counter.update(message.data, state.counterState)
      const newState = {...state, counterState: newCounterState}
      return [newState, mapEffect(counterEffect, counterMessage)]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>This is the root program.</p>
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
    </div>
  }
}
```

The parent decides the initial count with `initWithCount` instead of using the regular `init`. We are not following the program structure precisely. The parent always has access to the full state of its children so we are free to be creative with how we communicate to the child from the parent. Variations on `init`, `update`, and `view` are good places to start.

We created the `initWithCount` which returns the provided number in an array. This may seem like overkill when we *could* do `{counterState: 42}` based on what we know about how the counter's implementation. Work with a child's state through provided methods instead of via direction manipulation. Having these contracts communicated by methods allows the implementation details of the counter to change without breaking the parent. For example, if the counter ever adds an initial effect we will not have to change the parent(s) that use it.

### 4.4. Child to parent communication
We want to let the parent program know when the counter is high `> 100`.

```js
// back in counter.js
export function isCountHigh (state) {
  return state > 100
}
```

```js
import {mapEffect} from 'raj-compose'
import counter, {isCountHigh} from './counter'

const counterMessage = message => ({
  type: 'counterMessage',
  data: message
})

const [counterState, counterEffect] = counter.init
const init = [
  {counterState},
  mapEffect(counterEffect, counterMessage)
]

export default {
  init,
  update (message, state) {
    if (message.type === 'counterMessage') {
      const [
        newCounterState,
        counterEffect
      ] = counter.update(message.data, state.counterState)
      const newState = {...state, counterState: newCounterState}
      if (isCountHigh(newCounterState)) {
        // TODO: do something because the count is too dang high
      }
      return [newState, mapEffect(counterEffect, counterMessage)]
    }
  },
  view (state, dispatch) {
    return <div>
      <p>This is the root program.</p>
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
      {counter.view(
        state.counterState,
        message => dispatch(counterMessage(message))
      )}
    </div>
  }
}
```

Again we use the same strategy of having the counter provide a method which the parent can call. Here after every counter `update` the parent can check if the counter is too high and act appropriately. Having the same communication pattern work for both parent-to-child and child-to-parent is nice.

Composition is an art. Raj gives you the freedom to be creative with how you fit these pieces together. When you do put a program into the runtime it does have to follow the program pattern but subprograms can glue together to best fit your application.

The `raj-compose` library has recommended composition utilities worth getting familiar with. If your application goes Single-Page Application (SPA) check out the ecosystem [`raj-spa`](https://github.com/andrejewski/raj-spa) program that uses `raj-compose` and the composition patterns above.

## 5. Prove It
We have touched on a lot. The best for last is here. The main focus of Raj is testability and we should look at the advantages of architecting our programs the way the runtime makes us.

Testing `init` is a deep equal equality check. Testing `update` is constructing a message and input state and doing a deep equality check on the output. Test the `view` and effects by what messages they send `dispatch`. Testing is consistent and simple.

Giving up side-effects to the runtime also means the rest of your code can be synchronous. Most business logic you write will be input-output, testable with unit tests which are easier to reason about and much faster to run than their asynchronous counterparts.

### 5.1. Debugging
Raj has a terrific debugging experience due to how small it is. Application stack traces are almost entirely of code belonging to the application. Coming from frameworks where the stack traces can easily be hundreds of functions deep, all irrelevant to the problem at hand, the signal to noise ratio is amazing stepping through a Raj program.

Leveraging composition patterns we also can build reusable and powerful debugging utilities.

A question newcomers to Raj ask is, "How can I get access to the current state?" This is a fair question because other state-management solutions offer those APIs. The reason Raj does not is because it is an anti-pattern to avoid in everything but development. The reason for this is contract boundaries between programs. It would be too easy for a programmer to mistakenly make assumptions about the running program from the outside, relying on specifics of the app state that may change over time. Thus Raj does not offer that foot-gun, but you can add it at your own risk.

```js
function tapProgram (program, onChange) {
  return {
    ...program,
    view (model, dispatch) {
      onChange(model)
      return program.view(model, dispatch)
    }
  }
}
```

This `tapProgram` is a high-order-program (HOP), a function which accepts a Raj program as input and returns a Raj program. Anytime the program's state changes, we call `onChange()` with the new state. Using this HOP, we could for example have the current program state set on `window.app` via:

```js
import { tapProgram } from './above-snippet'
import { myProgram } from './my-app'
import { runtime } from 'raj'

const newProgram = tapProgram(myProgram, state => {
  window.app = state
})

runtime(newProgram)
```

Another question is, "How can I do error handling?" This is important for production applications which must adapt to and record errors. We can use another high-order-program `errorProgram` to trap program errors:

```js
function errorProgram (program, errorView) {
  const [programModel, programEffect] = program.init
  const init = [
    { hasError: false, error: null, programModel },
    programEffect
  ]

  function update (msg, model) {
    let change
    try {
      change = program.update(msg, model.programModel)
    } catch (error) {
      return [{ ...model, hasError: true, error }]
    }

    const [programModel, programEffect] = change
    return [{ ...model, programModel }), programEffect]
  }

  function view (model, dispatch) {
    return model.hasError
      ? errorView({ error: model.error })
      : program.view(model.programModel, dispatch)
  }

  let done
  if (program.done) {
    done = function (model) {
      return program.done(model.programModel)
    }
  }

  return { init, update, view, done }
}
```

We can catch errors that happen in the `update()` of all programs within `errorProgram` and display an error view based on the thrown error. Error recording is not demonstrated, but follows the same composition pattern. Also note that `errorProgram` is view-library independent.

The pinnacle byproduct of this highly testable architecture is the ecosystem [`raj-web-debugger`](https://github.com/andrejewski/raj-web-debugger). Leveraging the program pattern, we get a time traveling debugger for free. We record every state in our application and pause, play, rewind, and fast-forward them at will while developing. In two line changes, the debugger HOP can wrap any Raj program:

```diff
import { runtime } from 'raj'
import { myProgram } from './my-app'
+ import debug from 'raj-web-debugger'

- runtime(myProgram)
+ runtime(debug(myProgram))
```

## 6. Elm Street
Raj adapts the Elm Architecture for JavaScript. Trying [Elm](http://elm-lang.org/) is highly recommended and Raj serves to bring its architecture to JavaScript until Elm is ready for JavaScript's much wider community.

Notably, Elm and Raj handle subscriptions and side-effects differently. In Raj any side-effect can be a subscription. In Elm there are commands (single dispatch) and subscriptions (multi-dispatch). In Raj you write a subscription to receive a message every interval of time like this:

```js
export function everyTime (milliseconds, tagger) {
  let intervalId
  return {
    effect (dispatch) {
      intervalId = setInterval(() => {
        dispatch(tagger(Date.now()))
      }, milliseconds)
    },
    cancel () {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }
}
```

In Elm, the [same subscription](http://package.elm-lang.org/packages/elm-lang/core/latest/Time#every) uses [effect managers](https://github.com/elm-lang/core/blob/b06aa4421f9016c820576eb6a38174b6137fe052/src/Time.elm#L164-L243) and requires help from the [low-level Elm runtime](https://github.com/elm-lang/core/blob/b06aa4421f9016c820576eb6a38174b6137fe052/src/Native/Time.js#L10) to work. Elm's solution fits its language. The Raj solution fits JavaScript.

Expect Elm to develop into a language that makes Raj obsolete as it solves the harder problems of client application development. Until then Raj brings Elm's great architectural patterns to you today.

</raj-docs>

Here are some notes from our re-implementation of doc-handle using TEA:

### Integrating the TEA-Based `DocHandle`: A Guide for Developers

This document provides guidance for developers integrating the new TEA-based `DocHandle` into the larger systems of the `@loro-extended/repo`, specifically the `Repo` and `Synchronizer`. A solid understanding of these principles is essential for building a robust, scalable, and maintainable synchronization system.

---

### 1. The Core Architectural Split: Program vs. Runtime

The most critical concept to understand is the strict separation of concerns between the **pure program** and the **impure runtime host**.

*   **`doc-handle-program.ts` (The Pure Program)**: This file is the logical core. It defines the state machine in its purest form: `(state, message) => [newState, command]`. It knows nothing about storage, networks, timers, or even `LoroDoc` itself beyond its type signature. It is synchronous, deterministic, and easily testable. Its only job is to decide what happens next based on what just happened.
*   **`doc-handle.ts` (The Impure Runtime Host)**: This class is the "engine." It holds the current state of a document, provides the public API (`find`, `create`, `change`), and drives the state machine. Its most important job is to **execute the `Commands`** returned by the pure program. This is where the messy, asynchronous, real-world work happens.

**Advice**: Always maintain this separation.
*   **DO NOT** add any asynchronous logic, promises, or external dependencies to `doc-handle-program.ts`. All such logic belongs in the effect execution block (`#executeCommand`) of `doc-handle.ts`.
*   **DO** model any new side effect as a new `Command` type. For example, if you add an authentication step, you'd create a `RequestAuthTokenCommand` and handle its execution in the runtime host.

### 2. The `Repo` as the "Grand Central" for Services

The `DocHandle` is intentionally "dumb" about *how* to perform side effects. It only knows that it *needs* to. The `Repo` class should be the central authority that owns and manages the concrete implementations of these services.

*   **Storage**: The `Repo` should be configured with a `StorageSubsystem`. When the `Repo` creates a `DocHandle`, it should inject the `storageSubsystem.loadDoc` method into the handle's `DocHandleServices`.
*   **Network**: The `Repo` will own the `NetworkSubsystem` and the `Synchronizer`. When a `DocHandle`'s program issues a `QueryNetworkCommand`, the `Repo` should route that request to the appropriate synchronizer.

**Mistake to Avoid**: Instantiating `DocHandle`s directly without providing the necessary services. This will lead to runtime warnings and non-functional handles. The `Repo` should be the exclusive factory for `DocHandle`s.

```typescript
// Inside the Repo class...
public find<T>(documentId: DocumentId): DocHandle<T> {
  const handle = new DocHandle(documentId, {
    // Inject the Repo's own storage and network capabilities
    loadFromStorage: (id) => this.storage.loadDoc(id),
    queryNetwork: (id, timeout) => this.synchronizer.query(id, timeout),
  });
  handle.find(); // Kick off the process
  return handle;
}
```

### 3. The `Synchronizer` as an Effect Handler

The `Synchronizer`'s role becomes much clearer in this architecture. It is essentially a specialized **effect handler** for network-related commands.

**How it should work:**

1.  A `DocHandle`'s program returns a `QueryNetworkCommand`.
2.  The `DocHandle`'s `#executeCommand` method receives this command. The injected `queryNetwork` service (provided by the `Repo`) should then delegate this to the `Synchronizer`.
3.  The `Synchronizer` receives the query, broadcasts it to its peers, and manages the timeout logic.
4.  When a result is received (either a found document from a peer or a timeout), the `Synchronizer` **does not** modify the `DocHandle` directly. Instead, it calls the appropriate public method on the `DocHandle` (e.g., `handle.applySyncMessage(data)`). This then dispatches a new `Message` back into the pure program, closing the loop.

**Mistake to Avoid**: Having the `Synchronizer` directly manipulate the `DocHandle`'s internal state (e.g., `handle["#state"] = "unavailable"`). This breaks the entire TEA model. All state changes *must* go through the `dispatch -> update` cycle.

### 4. Thinking in Events and Commands

When scaling this to manage many documents and peers, think of the system as a series of event streams and command buses.

*   **Many Documents**: The `Repo` will manage a collection of `DocHandle` instances. Each handle is a self-contained state machine. The `Repo` listens to events from all handles (e.g., `sync-message` events) and routes them to the appropriate subsystem (e.g., the `NetworkSubsystem`).
*   **Many Peers**: The `NetworkSubsystem` receives sync messages from the `Repo` and broadcasts them. When it receives a message from a peer, it determines the `documentId` and forwards it to the `Repo`, which in turn finds the correct `DocHandle` and calls `applySyncMessage`.

**Advice**: Leverage the fact that the state is explicit and event-driven. You can build powerful debugging tools by simply logging all `Messages`, `Commands`, and `state-change` events. This provides a complete, auditable trail of everything that happens in the system, which is invaluable for troubleshooting complex, distributed interactions. The `raj-web-debugger` is a testament to the power of this pattern.

NOTE: We will similarly be creating a pure repo-program.ts and a new (refactored) repo.ts host class with public interface.

Check out our notes at @/packages/repo/src/synchronizer/synchronizer.md to learn about its role as a "servant" to Repo class we'll be re-writing.

Let's start with the pure repo-program.ts file.

# DocHandle TEA

Integrating the TEA-Based DocHandle: A Guide for Developers
This document provides guidance for developers integrating the new TEA-based DocHandle into the larger systems of the @loro-extended/repo, specifically the Repo and Synchronizer. A solid understanding of these principles is essential for building a robust, scalable, and maintainable synchronization system.

1. The Core Architectural Split: Program vs. Runtime
The most critical concept to understand is the strict separation of concerns between the pure program and the impure runtime host.

doc-handle-program.ts (The Pure Program): This file is the logical core. It defines the state machine in its purest form: (state, message) => [newState, command]. It knows nothing about storage, networks, timers, or even LoroDoc itself beyond its type signature. It is synchronous, deterministic, and easily testable. Its only job is to decide what happens next based on what just happened.
doc-handle.ts (The Impure Runtime Host): This class is the "engine." It holds the current state of a document, provides the public API (find, create, change), and drives the state machine. Its most important job is to execute the Commands returned by the pure program. This is where the messy, asynchronous, real-world work happens.
Advice: Always maintain this separation.

DO NOT add any asynchronous logic, promises, or external dependencies to doc-handle-program.ts. All such logic belongs in the effect execution block (#executeCommand) of doc-handle.ts.
DO model any new side effect as a new Command type. For example, if you add an authentication step, you'd create a RequestAuthTokenCommand and handle its execution in the runtime host.
2. The Repo as the "Grand Central" for Services
The DocHandle is intentionally "dumb" about how to perform side effects. It only knows that it needs to. The Repo class should be the central authority that owns and manages the concrete implementations of these services.

Storage: The Repo should be configured with a StorageSubsystem. When the Repo creates a DocHandle, it should inject the storageSubsystem.loadDoc method into the handle's DocHandleServices.
Network: The Repo will own the NetworkSubsystem and the Synchronizer. When a DocHandle's program issues a QueryNetworkCommand, the Repo should route that request to the appropriate synchronizer.
Mistake to Avoid: Instantiating DocHandles directly without providing the necessary services. This will lead to runtime warnings and non-functional handles. The Repo should be the exclusive factory for DocHandles.

// Inside the Repo class...
public find<T>(documentId: DocumentId): DocHandle<T> {
  const handle = new DocHandle(documentId, {
    // Inject the Repo's own storage and network capabilities
    loadFromStorage: (id) => this.storage.loadDoc(id),
    queryNetwork: (id, timeout) => this.synchronizer.query(id, timeout),
  });
  handle.find(); // Kick off the process
  return handle;
}

typescript


3. The Synchronizer as an Effect Handler
The Synchronizer's role becomes much clearer in this architecture. It is essentially a specialized effect handler for network-related commands.

How it should work:

A DocHandle's program returns a QueryNetworkCommand.
The DocHandle's #executeCommand method receives this command. The injected queryNetwork service (provided by the Repo) should then delegate this to the Synchronizer.
The Synchronizer receives the query, broadcasts it to its peers, and manages the timeout logic.
When a result is received (either a found document from a peer or a timeout), the Synchronizer does not modify the DocHandle directly. Instead, it calls the appropriate public method on the DocHandle (e.g., handle.applySyncMessage(data)). This then dispatches a new Message back into the pure program, closing the loop.
Mistake to Avoid: Having the Synchronizer directly manipulate the DocHandle's internal state (e.g., handle["#state"] = "unavailable"). This breaks the entire TEA model. All state changes must go through the dispatch -> update cycle.

4. Thinking in Events and Commands
When scaling this to manage many documents and peers, think of the system as a series of event streams and command buses.

Many Documents: The Repo will manage a collection of DocHandle instances. Each handle is a self-contained state machine. The Repo listens to events from all handles (e.g., sync-message events) and routes them to the appropriate subsystem (e.g., the NetworkSubsystem).
Many Peers: The NetworkSubsystem receives sync messages from the Repo and broadcasts them. When it receives a message from a peer, it determines the documentId and forwards it to the Repo, which in turn finds the correct DocHandle and calls applySyncMessage.
Advice: Leverage the fact that the state is explicit and event-driven. You can build powerful debugging tools by simply logging all Messages, Commands, and state-change events. This provides a complete, auditable trail of everything that happens in the system, which is invaluable for troubleshooting complex, distributed interactions. The raj-web-debugger is a testament to the power of this pattern.

# Synchronizer TEA

Here is a technical summary of the architectural refactor of the `Synchronizer`.

### `Synchronizer` Architecture: A Post-Mortem

This document details the architecture of the `Synchronizer`, which was refactored to use The Elm Architecture (TEA) via the `raj-ts` library. This change brings significant improvements in predictability, testability, and maintainability.

#### 1. Motivation: From Mixed Paradigm to Pure State Machine

The original `Synchronizer` implementation mixed several paradigms:
*   It directly manipulated the state of `DocHandle` instances.
*   It managed its own state through internal properties (`#peers`, `#announcedDocs`).
*   It acted as an event emitter.
*   It directly managed network message creation and timers.

This approach led to tight coupling between components, made the overall state of the system difficult to track, and blurred the lines of responsibility, making the logic hard to test and reason about.

#### 2. New Architecture: A Pure Program and an Impure Host

Inspired by the prior refactor of the `DocHandle`, we separated the `Synchronizer`'s concerns into two distinct components:

1.  **`synchronizer-program.ts` (The Pure Core):** This file exports a pure `update` function: `(message, state) => [newState, command]`. It is completely deterministic and has no knowledge of the outside world (networks, timers, etc.). Its only job is to calculate the next state based on the current state and a `Message`.

2.  **`synchronizer.ts` (The Impure Host):** This class is the runtime engine. It instantiates the `raj-ts` runtime with the pure program. Its responsibilities are:
    *   **Driving the State:** Exposing a public API (`addPeer`, `beginSync`) that translates method calls into `Message`s dispatched to the pure program.
    *   **Executing Side Effects:** Receiving `Command` data objects from the pure program and executing them. This is where all interaction with the outside world happens (e.g., sending network messages, setting timeouts).
    *   **Translating External Events:** Taking incoming `RepoMessage`s from the network and translating them into `Message`s for the pure program, thus "closing the loop."

#### 3. Data Flow and Core Components

The new system is defined by three key types:

*   **`Model`**: A single, immutable data structure that represents the entire state of the synchronization process (peers, document availability, active sync states, retry counts).
*   **`Message`**: A union type of all possible events that can occur, such as `:peer_added`, `:received_announce`, or `:sync_timeout_fired`.
*   **`Command`**: A declarative data object describing a side effect the pure program wants the host to perform, such as `:send_message` or `:set_timeout`.

This structure ensures that all state logic is centralized and testable, while all impure actions are isolated and explicitly described.

#### 4. Key Architectural Decisions & Trade-offs

During the refactor, several important architectural decisions were made:

*   **Timeout as a Signal, Not a Failure:** The previous implementation used a hard timeout to mark documents as "unavailable." This is brittle in real-world networks. The new design treats a timeout as just another `Message` (`:sync_timeout_fired`). The pure `update` function can then implement a more robust retry strategy with exponential backoff, making the system more resilient to network latency.

*   **Permissions as a Host-Level Concern:** The temptation to include permission checks within the pure program was resisted. Instead, authorization is handled in the **impure host**. The pure program generates a command (e.g., `:load_and_send_sync`), and the host's `#executeCommand` method is responsible for verifying permissions *before* executing the effect. This maintains the purity of the core logic and correctly places authorization at the system's boundary.

*   **Asynchronous Testing Strategy:** Initial attempts to test the host class failed due to timing issues with `vi.useFakeTimers()`. The `raj-ts` runtime uses promises for its effect-handling loop, which are not coupled to fake timers. The correct testing strategy was to remove fake timers and `await` a `tick()` function (`setImmediate`) to allow the Node.js event loop to process pending promises between the action and assertion phases of the test.

*   **Adherence to `raj-ts`:** There was a learning curve in conforming to the `raj-ts` library's specific `Program` type. The key insight was that `update` must return a union type of `[Model]` or `[Model, Effect | undefined]`, and our wrapper function was modified to match this signature precisely without using type casts, thus ensuring type safety.

This refactor has resulted in a `Synchronizer` that is more robust, easier to reason about, and significantly more testable than its predecessor.