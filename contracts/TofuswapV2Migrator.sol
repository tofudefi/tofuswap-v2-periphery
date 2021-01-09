pragma solidity =0.5.14;

import './libraries/TransferHelper.sol';

import './interfaces/ITofuswapV2Migrator.sol';
import './interfaces/V1/ITofuswapV1Factory.sol';
import './interfaces/V1/ITofuswapV1Exchange.sol';
import './interfaces/ITofuswapV2Router01.sol';
import './interfaces/IERC20.sol';

contract TofuswapV2Migrator is ITofuswapV2Migrator {
    ITofuswapV1Factory public factoryV1;
    ITofuswapV2Router01 public router;

    constructor(address _factoryV1, address _router) public {
        factoryV1 = ITofuswapV1Factory(_factoryV1);
        router = ITofuswapV2Router01(_router);
    }

    // @TRON:
    // class org.tron.core.services.http.JsonFormat$ParseException : 1:511: Enum type "protocol.SmartContract.ABI.Entry.EntryType" has no value named "Receive".
    // needs to accept TRX from any v1 exchange and the router. ideally this could be enforced, as in the router,
    // but it's not possible because it requires a call to the v1 factory, which takes too much gas
    // receive() external payable {}

    // MOD(tron): go back to solidity 0.5.x
    function () external payable {}

    function migrate(address token, uint amountTokenMin, uint amountTRXMin, address to, uint deadline)
        external
    {
        ITofuswapV1Exchange exchangeV1 = ITofuswapV1Exchange(factoryV1.getExchange(token));
        uint liquidityV1 = exchangeV1.balanceOf(msg.sender);
        require(exchangeV1.transferFrom(msg.sender, address(this), liquidityV1), 'TRANSFER_FROM_FAILED');
        (uint amountTRXV1, uint amountTokenV1) = exchangeV1.removeLiquidity(liquidityV1, 1, 1, uint(-1));
        TransferHelper.safeApprove(token, address(router), amountTokenV1);
        (uint amountTokenV2, uint amountTRXV2,) = router.addLiquidityTRX.value(amountTRXV1)(
            token,
            amountTokenV1,
            amountTokenMin,
            amountTRXMin,
            to,
            deadline
        );
        if (amountTokenV1 > amountTokenV2) {
            TransferHelper.safeApprove(token, address(router), 0); // be a good blockchain citizen, reset allowance to 0
            TransferHelper.safeTransfer(token, msg.sender, amountTokenV1 - amountTokenV2);
        } else if (amountTRXV1 > amountTRXV2) {
            // addLiquidityTRX guarantees that all of amountTRXV1 or amountTokenV1 will be used, hence this else is safe
            TransferHelper.safeTransferTRX(msg.sender, amountTRXV1 - amountTRXV2);
        }
    }
}
