pragma solidity >=0.5.0;

interface ITofuswapV2Migrator {
    function migrate(address token, uint amountTokenMin, uint amountTRXMin, address to, uint deadline) external;
}
