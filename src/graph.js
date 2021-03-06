// @flow
import React, {
    Component,
} from 'react';
import {
    List,
} from 'immutable';
import Measure from 'react-measure';

import Node from './node';
import Edge from './edge';

import {
    Node as NodeData,
} from './state';

// eslint-disable-next-line no-duplicate-imports
import type GraphState, {
    Pin as PinData,
} from './state';

import {
    graph,
    scroll,
} from './graph.css';

declare class SVGElement extends HTMLElement {
    getBBox: () => {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

type Props = {
    className: string,
    style: Object,

    value: GraphState,
    onChange: (nextState: GraphState) => void,

    nodeClass: ReactClass<any>,
    pinClass: ReactClass<any>,
    menuClass: ?ReactClass<any>
};

type BatchedAction = {
    method: string,
    args: Array<any>
}

function NOOP() {}

const raf = (
    window ? (
        window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame
    ) : null
) || (cb => setTimeout(cb, 16));

export default class Graph extends Component {
    constructor(props: Props) {
        super(props);

        this.__actionQueue = new List();

        this.mouseDown = (evt: SyntheticMouseEvent) => {
            evt.preventDefault();

            if (this.__graph) {
                let nextState = this.props.value;
                if (evt.target === this.__graph) {
                    nextState = nextState.closeMenu();
                }

                const { x, y } = this.getGraphCoords(evt);
                this.props.onChange(
                    nextState._startMouse(evt.buttons, x, y),
                );
            }
        };

        this.mouseMove = (evt: SyntheticMouseEvent) => {
            if (this.__graph && this.props.value.mouseState.down) {
                evt.preventDefault();
                evt.stopPropagation();

                const { x, y } = this.getGraphCoords(evt);
                this.props.onChange(
                    this.props.value._updateMouse(x, y),
                );
            }
        };

        this.mouseUp = (evt: SyntheticMouseEvent) => {
            if (this.props.value.mouseState.down) {
                evt.preventDefault();
                evt.stopPropagation();

                let nextState = this.props.value._endMouse();
                if (this.props.value.mouseState.draggingEdge) {
                    const { x, y } = this.getGraphCoords(evt);
                    nextState = nextState.openMenu(x, y);
                }

                this.props.onChange(nextState);
            }
        };

        this.contextMenu = (evt: SyntheticMouseEvent) => {
            if (process.env.NODE_ENV === 'development' && evt.shiftKey) {
                return;
            }

            evt.preventDefault();

            const { x, y } = this.getGraphCoords(evt);
            this.props.onChange(
                this.props.value.openMenu(x, y),
            );
        };

        this.measureViewport = (rect: {width: number, height: number}) => {
            this.batchAction({
                method: '_measureViewport',
                args: [rect.width, rect.height],
            });
        };

        this.measureNode = (id: number, width: number, height: number) => {
            this.batchAction({
                method: '_measureNode',
                args: [id, width, height],
            });
        };

        this.measurePin = (id: number, y: number, height: number) => {
            this.batchAction({
                method: '_measurePin',
                args: [id, y, height],
            });
        };

        this.clickNode = (id: number, evt: SyntheticMouseEvent) => {
            if (!this.isSelected(id)) {
                this.props.onChange(
                    this.props.value
                        .closeMenu()
                        .selectNode(id, evt.ctrlKey),
                );
            }
        };

        this.moveNode = (id: number, x: number, y: number, final: ?boolean = false) => {
            this.props.onChange(
                this.props.value.moveNode(id, x, y, final),
            );
        };

        this.dragPin = (node: NodeData, pin: PinData, evt: SyntheticMouseEvent) => {
            if (this.__graph) {
                evt.preventDefault();
                evt.stopPropagation();

                const { x, y } = this.getGraphCoords(evt);
                this.props.onChange(
                    this.props.value
                        ._startMouse(evt.buttons, x, y)
                        ._startConnection(node, pin),
                );
            }
        };

        this.dropPin = (node: NodeData, pin: PinData, evt: SyntheticMouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();

            this.props.onChange(
                this.props.value._endConnection(node, pin),
            );
        };
    }

    getGraphCoords(evt: SyntheticMouseEvent): {x: number, y: number} {
        return {
            x: evt.clientX - this.props.value.viewport.startX,
            y: evt.clientY - this.props.value.viewport.startY,
        };
    }

    isSelected(node: NodeData) {
        return this.props.value.isSelected(node);
    }

    batchAction(action: BatchedAction) {
        if (this.__actionQueue.isEmpty()) {
            raf(() => {
                const currentQueue = this.__actionQueue;
                this.__actionQueue = this.__actionQueue.clear();

                this.props.onChange(
                    currentQueue.reduce((state, item) =>
                        state[item.method](...item.args)
                    , this.props.value),
                );
            });
        }

        this.__actionQueue = this.__actionQueue.push(action);
    }

    props: Props;

    __graph: HTMLDivElement;
    __actionQueue: List<BatchedAction>;

    mouseDown: (evt: SyntheticMouseEvent) => void;
    mouseMove: (evt: SyntheticMouseEvent) => void;
    mouseUp: (evt: SyntheticMouseEvent) => void;
    contextMenu: (evt: SyntheticMouseEvent) => void;
    measureViewport: (rect: {width: number, height: number}) => void;
    measureNode: (id: number, width: number, height: number) => void;
    measurePin: (id: number, y: number, height: number) => void;
    clickNode: (id: number, evt: SyntheticMouseEvent) => void;
    moveNode: (id: number, x: number, y: number, final: ?boolean) => void;
    dragPin: (node: NodeData, pin: PinData, evt: SyntheticMouseEvent) => void;
    dropPin: (node: NodeData, pin: PinData, evt: SyntheticMouseEvent) => void;

    render() {
        const {
            nodeClass, pinClass,
            menuClass: MenuClass,
            className, style,
        } = this.props;
        const {
            editorState,
            mouseState,
            menuState,
            viewport
        } = this.props.value;
        const {
            nodes, edges,
        } = editorState;
        const {
            translateX, translateY,
        } = viewport;

        const dragLine = (() => {
            if (mouseState.down !== 1) {
                return null;
            }

            if (mouseState.draggingEdge) {
                return (
                    <Edge origin={nodes.get(mouseState.node)} dest={new NodeData({
                        x: mouseState.x,
                        y: mouseState.y,
                        minPin: 0,
                    })} edge={{
                        output: mouseState.pin,
                        input: 0,
                        color: '#fff',
                    }} />
                );
            }

            const {
                minX, minY,
                maxX, maxY,
            } = mouseState.rect;

            return (
                <rect
                    x={minX} y={minY}
                    width={maxX - minX}
                    height={maxY - minY} />
            );
        })();

        return (
            <Measure whiteList={['width', 'height']} onMeasure={this.measureViewport}>
                <div
                    className={`${graph} ${className}`}
                    style={style}
                    onMouseDown={this.mouseDown}
                    onMouseMove={this.mouseMove}
                    onMouseUp={this.mouseUp}
                    onContextMenu={this.contextMenu}
                    ref={elem => {
                        this.__graph = elem;
                    }}>

                    <svg>
                        <g transform={`translate(${translateX}, ${translateY})`}>
                            {edges.map(edge => {
                                const from = nodes.get(edge.from);
                                const to = nodes.get(edge.to);

                                return from && to && (
                                    <Edge
                                        key={`${from.id}:${edge.output}-${to.id}:${edge.input}`}
                                        origin={from} dest={to}
                                        edge={edge} />
                                );
                            })}
                            {dragLine}
                        </g>
                    </svg>

                    <div className={scroll} style={{
                        transform: `translate(${translateX}px, ${translateY}px)`,
                    }}>
                        {nodes.map(node => (
                            <Node key={node.id} node={node}
                                nodeClass={nodeClass}
                                pinClass={pinClass}
                                measureNode={this.measureNode}
                                measurePin={this.measurePin}
                                moveNode={this.moveNode}
                                mouseDown={this.clickNode}
                                dragPin={mouseState.draggingEdge ? NOOP : this.dragPin}
                                dropPin={mouseState.draggingEdge ? this.dropPin : NOOP}
                                selected={this.isSelected(node.id)} />
                        )).toArray()}

                        {MenuClass && menuState.open && <MenuClass menu={menuState} />}
                    </div>
                </div>
            </Measure>
        );
    }
}
