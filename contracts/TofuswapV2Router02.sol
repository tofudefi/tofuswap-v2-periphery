pragma solidity =0.5.14;

import '@tofudefi/tofuswap-v2-core/contracts/interfaces/ITofuswapV2Factory.sol';
import '@tofudefi/tofuswap-v2-core/contracts/interfaces/ITofuFreeze.sol';
import './libraries/TransferHelper.sol';

import './interfaces/ITofuswapV2Router02.sol';
import './libraries/TofuswapV2LibraryTofu.sol';
import './libraries/SafeMath.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWTRX.sol';

contract TofuswapV2Router02 is ITofuswapV2Router02 {
    using SafeMath for uint;

    address public factory;
    address public WTRX;
    address public tofuFreeze;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'TofuswapV2Router: EXPIRED');
        _;
    }

    constructor(address _factory, address _WTRX) public {
        factory = _factory;
        WTRX = _WTRX;
        tofuFreeze = ITofuswapV2Factory(factory).tofuFreeze();
    }

    // MOD(tron): receive() not supported by TVM but fallback() is
    function () external payable {
        assert(msg.sender == WTRX); // only accept TRX via fallback from the WTRX contract
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal returns (uint amountA, uint amountB) {
        // create the pair if it doesn't exist yet
        if (ITofuswapV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            ITofuswapV2Factory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = TofuswapV2LibraryTofu.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = TofuswapV2LibraryTofu.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'TofuswapV2Router: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = TofuswapV2LibraryTofu.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'TofuswapV2Router: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = TofuswapV2LibraryTofu.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = ITofuswapV2Pair(pair).mint(to);
    }
    function addLiquidityTRX(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountTRXMin,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint amountToken, uint amountTRX, uint liquidity) {
        (amountToken, amountTRX) = _addLiquidity(
            token,
            WTRX,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountTRXMin
        );
        address pair = TofuswapV2LibraryTofu.pairFor(factory, token, WTRX);
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        IWTRX(WTRX).deposit.value(amountTRX)();
        assert(IWTRX(WTRX).transfer(pair, amountTRX));
        liquidity = ITofuswapV2Pair(pair).mint(to);
        // refund dust trx, if any
        if (msg.value > amountTRX) TransferHelper.safeTransferTRX(msg.sender, msg.value - amountTRX);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = TofuswapV2LibraryTofu.pairFor(factory, tokenA, tokenB);
        ITofuswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair
        (uint amount0, uint amount1) = ITofuswapV2Pair(pair).burn(to);
        (address token0,) = TofuswapV2LibraryTofu.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'TofuswapV2Router: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'TofuswapV2Router: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidityTRX(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTRXMin,
        address to,
        uint deadline
    ) public ensure(deadline) returns (uint amountToken, uint amountTRX) {
        (amountToken, amountTRX) = removeLiquidity(
            token,
            WTRX,
            liquidity,
            amountTokenMin,
            amountTRXMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        IWTRX(WTRX).withdraw(amountTRX);
        TransferHelper.safeTransferTRX(to, amountTRX);
    }
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external returns (uint amountA, uint amountB) {
        address pair = TofuswapV2LibraryTofu.pairFor(factory, tokenA, tokenB);
        uint value = approveMax ? uint(-1) : liquidity;
        ITofuswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }
    function removeLiquidityTRXWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTRXMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external returns (uint amountToken, uint amountTRX) {
        address pair = TofuswapV2LibraryTofu.pairFor(factory, token, WTRX);
        uint value = approveMax ? uint(-1) : liquidity;
        ITofuswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountTRX) = removeLiquidityTRX(token, liquidity, amountTokenMin, amountTRXMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityTRXSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTRXMin,
        address to,
        uint deadline
    ) public ensure(deadline) returns (uint amountTRX) {
        (, amountTRX) = removeLiquidity(
            token,
            WTRX,
            liquidity,
            amountTokenMin,
            amountTRXMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
        IWTRX(WTRX).withdraw(amountTRX);
        TransferHelper.safeTransferTRX(to, amountTRX);
    }
    function removeLiquidityTRXWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTRXMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external returns (uint amountTRX) {
        address pair = TofuswapV2LibraryTofu.pairFor(factory, token, WTRX);
        uint value = approveMax ? uint(-1) : liquidity;
        ITofuswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountTRX = removeLiquidityTRXSupportingFeeOnTransferTokens(
            token, liquidity, amountTokenMin, amountTRXMin, to, deadline
        );
    }

    // return fee basis point if tx.origin freeze TOFU    
    function getFeeBasisPoints() internal view returns (uint feeBasisPoints) {
        uint originTofuBalance = ITofuFreeze(tofuFreeze).balanceOf(tx.origin);

	if (originTofuBalance >= 100000000000) {
	    return 10;
	} else if (originTofuBalance >= 10000000000) {
	    return 15;
	} else if (originTofuBalance >= 1000000000) {
	    return 20;
	} else if (originTofuBalance >= 100000000) {
	    return 25;
	} 
	return 30;
    } 

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(uint[] memory amounts, address[] memory path, address _to, bool withTofu) internal {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = TofuswapV2LibraryTofu.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? TofuswapV2LibraryTofu.pairFor(factory, output, path[i + 2]) : _to;
            if (withTofu) {
	        ITofuswapV2Pair(TofuswapV2LibraryTofu.pairFor(factory, input, output)).swapWithTofu(
		        amount0Out, amount1Out, to, new bytes(0)
		);
            } else {
	        ITofuswapV2Pair(TofuswapV2LibraryTofu.pairFor(factory, input, output)).swap(
		        amount0Out, amount1Out, to, new bytes(0)
		);
            }
        }
    }
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        uint feeBasisPoints = getFeeBasisPoints();
        amounts = TofuswapV2LibraryTofu.getAmountsOut(factory, amountIn, feeBasisPoints, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to, feeBasisPoints < 30);
    }
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        uint feeBasisPoints = getFeeBasisPoints();
        amounts = TofuswapV2LibraryTofu.getAmountsIn(factory, amountOut, feeBasisPoints, path);
        require(amounts[0] <= amountInMax, 'TofuswapV2Router: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to, feeBasisPoints < 30);
    }
    function swapExactTRXForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        uint feeBasisPoints = getFeeBasisPoints();        
        amounts = TofuswapV2LibraryTofu.getAmountsOut(factory, msg.value, feeBasisPoints, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        IWTRX(WTRX).deposit.value(amounts[0])();
        assert(IWTRX(WTRX).transfer(TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to, feeBasisPoints < 30);
    }
    function swapTokensForExactTRX(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        uint feeBasisPoints = getFeeBasisPoints();        
        amounts = TofuswapV2LibraryTofu.getAmountsIn(factory, amountOut, feeBasisPoints, path);
        require(amounts[0] <= amountInMax, 'TofuswapV2Router: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this), feeBasisPoints < 30);
        IWTRX(WTRX).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferTRX(to, amounts[amounts.length - 1]);
    }
    function swapExactTokensForTRX(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        uint feeBasisPoints = getFeeBasisPoints();
        amounts = TofuswapV2LibraryTofu.getAmountsOut(factory, amountIn, feeBasisPoints, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this), feeBasisPoints < 30);
        IWTRX(WTRX).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferTRX(to, amounts[amounts.length - 1]);
    }
    function swapTRXForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        uint feeBasisPoints = getFeeBasisPoints();        
        amounts = TofuswapV2LibraryTofu.getAmountsIn(factory, amountOut, feeBasisPoints, path);
        require(amounts[0] <= msg.value, 'TofuswapV2Router: EXCESSIVE_INPUT_AMOUNT');
        IWTRX(WTRX).deposit.value(amounts[0])();
        assert(IWTRX(WTRX).transfer(TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to, feeBasisPoints < 30);
        // refund dust trx, if any, condition
        if (msg.value > amounts[0]) TransferHelper.safeTransferTRX(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    // requires the initial amount to have already been sent to the first pair
    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal {
        uint feeBasisPoints = getFeeBasisPoints();
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = TofuswapV2LibraryTofu.sortTokens(input, output);
            ITofuswapV2Pair pair = ITofuswapV2Pair(TofuswapV2LibraryTofu.pairFor(factory, input, output));
            uint amountInput;
            uint amountOutput;
            { // scope to avoid stack too deep errors
            (uint reserve0, uint reserve1,) = pair.getReserves();
            (uint reserveInput, uint reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = IERC20(input).balanceOf(address(pair)).sub(reserveInput);
            amountOutput = TofuswapV2LibraryTofu.getAmountOut(amountInput, reserveInput, reserveOutput, feeBasisPoints);
            }
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? TofuswapV2LibraryTofu.pairFor(factory, output, path[i + 2]) : _to;
            if (feeBasisPoints < 30) {
                pair.swapWithTofu(amount0Out, amount1Out, to, new bytes(0));
            } else {
                pair.swap(amount0Out, amount1Out, to, new bytes(0));
            }
        }
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) {
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amountIn
        );
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTRXForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        payable
        ensure(deadline)
    {
        require(path[0] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        uint amountIn = msg.value;
        IWTRX(WTRX).deposit.value(amountIn)();
        assert(IWTRX(WTRX).transfer(TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amountIn));
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTokensForTRXSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        ensure(deadline)
    {
        require(path[path.length - 1] == WTRX, 'TofuswapV2Router: INVALID_PATH');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, TofuswapV2LibraryTofu.pairFor(factory, path[0], path[1]), amountIn
        );
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint amountOut = IERC20(WTRX).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'TofuswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        IWTRX(WTRX).withdraw(amountOut);
        TransferHelper.safeTransferTRX(to, amountOut);
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(uint amountA, uint reserveA, uint reserveB) public pure returns (uint amountB) {
        return TofuswapV2LibraryTofu.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut)
        public
        view
        returns (uint amountOut)
    {
        return TofuswapV2LibraryTofu.getAmountOut(amountIn, reserveIn, reserveOut, getFeeBasisPoints());
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut)
        public
        view
        returns (uint amountIn)
    {
        return TofuswapV2LibraryTofu.getAmountIn(amountOut, reserveIn, reserveOut, getFeeBasisPoints());
    }

    function getAmountsOut(uint amountIn, address[] memory path)
        public
        view
        returns (uint[] memory amounts)
    {
        return TofuswapV2LibraryTofu.getAmountsOut(factory, amountIn, getFeeBasisPoints(), path);
    }

    function getAmountsIn(uint amountOut, address[] memory path)
        public
        view
        returns (uint[] memory amounts)
    {
        return TofuswapV2LibraryTofu.getAmountsIn(factory, amountOut, getFeeBasisPoints(), path);
    }
}
